/**
 * Media library scanning logic.
 * Recursively walks MEDIA_ROOT, syncs folders and media to SQLite.
 */
import fs from "fs";
import path from "path";
import { getDb } from "../db";
import { getConfig } from "../config";
import { probeMedia, getFileStats, MediaMetadata } from "./probe";
import {
  isSupported,
  getExtension,
  classifyMediaType,
  getMimeType,
  toRelativePath,
} from "./pathing";
import {
  generateThumbnail,
  generateMotionThumbnail,
  generateBlurhashForMedia,
  supportsMotionPreview,
} from "./thumbnails";

export interface ScanSummary {
  filesFound: number;
  filesAdded: number;
  filesUpdated: number;
  filesRemoved: number;
  foldersFound: number;
  foldersAdded: number;
  foldersRemoved: number;
  thumbnailsGenerated: number;
  blurhashesGenerated: number;
}

export interface ScanResult {
  success: boolean;
  summary: ScanSummary;
  error?: string;
}

/**
 * Gets or creates a folder by path, returning its ID and whether it was newly inserted.
 */
function upsertFolder(
  db: ReturnType<typeof getDb>,
  folderPath: string,
  parentId: number | null
): { id: number; inserted: boolean } {
  // Normalize: empty string and "." both mean root folder
  const normalizedPath = folderPath === "." ? "" : folderPath;
  const name = normalizedPath === "" ? "" : path.basename(normalizedPath);

  const existing = db
    .prepare("SELECT id FROM folders WHERE path = ?")
    .get(normalizedPath) as { id: number } | undefined;

  if (existing) {
    db.prepare("UPDATE folders SET updated_at = datetime('now') WHERE id = ?").run(
      existing.id
    );
    return { id: existing.id, inserted: false };
  }

  const result = db
    .prepare(
      "INSERT INTO folders (path, name, parent_id) VALUES (?, ?, ?)"
    )
    .run(normalizedPath, name, parentId);
  return { id: result.lastInsertRowid as number, inserted: true };
}

/**
 * Deletes folders that no longer exist on disk (except root) using a temp table
 * and a single SQL DELETE — avoids loading the entire table into memory.
 */
function removeStaleFolders(db: ReturnType<typeof getDb>, validPaths: Set<string>): number {
  if (validPaths.size === 0) {
    const result = db.prepare("DELETE FROM folders WHERE path != ''").run();
    return result.changes;
  }

  db.prepare("CREATE TEMP TABLE IF NOT EXISTS _valid_folder_paths (path TEXT PRIMARY KEY)").run();
  db.prepare("DELETE FROM _valid_folder_paths").run();

  const insert = db.prepare("INSERT OR IGNORE INTO _valid_folder_paths (path) VALUES (?)");
  const tx = db.transaction(() => {
    for (const p of validPaths) {
      insert.run(p);
    }
  });
  tx();

  const result = db.prepare(
    `DELETE FROM folders WHERE path != '' AND path NOT IN (SELECT path FROM _valid_folder_paths)`
  ).run();

  return result.changes;
}

/**
 * Upserts a media file into the database.
 */
interface UpsertMediaResult {
  status: "added" | "updated" | "skipped";
  mediaId?: number;
  mediaType?: string;
  relativePath?: string;
}

async function upsertMedia(
  db: ReturnType<typeof getDb>,
  folderId: number | null,
  absolutePath: string,
  relativePath: string
): Promise<UpsertMediaResult> {
  const ext = getExtension(absolutePath);
  if (!isSupported(ext)) return { status: "skipped" };

  const mediaType = classifyMediaType(ext);
  if (!mediaType) return { status: "skipped" };

  const fileStats = await getFileStats(absolutePath);
  if (!fileStats) return { status: "skipped" };

  const { size, mtime } = fileStats;
  const mtimeStr = mtime.toISOString();

  const existing = db
    .prepare("SELECT id, fs_mtime, file_size FROM media WHERE relative_path = ?")
    .get(relativePath) as
    | { id: number; fs_mtime: string; file_size: number }
    | undefined;

  if (existing) {
    // Skip if file hasn't changed
    if (existing.fs_mtime === mtimeStr && existing.file_size === size) {
      return { status: "skipped", mediaId: existing.id };
    }
    // Update existing
    const metadata = await probeMedia(absolutePath);
    db.prepare(
      `UPDATE media SET 
        folder_id = ?, filename = ?, mime_type = ?, media_type = ?,
        file_size = ?, width = ?, height = ?, duration_secs = ?,
        fs_mtime = ?, updated_at = datetime('now')
      WHERE id = ?`
    ).run(
      folderId,
      path.basename(absolutePath),
      metadata?.mimeType ?? getMimeType(ext),
      mediaType,
      size,
      metadata?.width ?? null,
      metadata?.height ?? null,
      metadata?.duration_secs ?? null,
      mtimeStr,
      existing.id
    );
    return { status: "updated", mediaId: existing.id, mediaType, relativePath };
  }

  // Insert new
  const metadata = await probeMedia(absolutePath);
  const result = db.prepare(
    `INSERT INTO media 
      (folder_id, relative_path, filename, mime_type, media_type,
       file_size, width, height, duration_secs, fs_mtime)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    folderId,
    relativePath,
    path.basename(absolutePath),
    metadata?.mimeType ?? getMimeType(ext),
    mediaType,
    size,
    metadata?.width ?? null,
    metadata?.height ?? null,
    metadata?.duration_secs ?? null,
    mtimeStr
  );
  return { status: "added", mediaId: result.lastInsertRowid as number, mediaType, relativePath };
}

interface BatchUpsertItem {
  relativePath: string;
  absolutePath: string;
  folderId: number | null;
}

interface BatchUpsertResult {
  added: number;
  updated: number;
  skipped: number;
  needsThumbnailGeneration: { mediaId: number; relativePath: string; mediaType: string }[];
}

/**
 * Batch-upserts media files into the database.
 *
 * Phase 1 – Classify: preload existing DB rows, stat each file, and decide
 *   whether to skip, update, or insert without any async I/O beyond stat.
 * Phase 2 – Probe: run sharp/ffprobe in parallel batches for changed/new files.
 * Phase 3 – Write: execute all INSERTs/UPDATEs in a single SQLite transaction.
 */
async function batchUpsertFiles(
  db: ReturnType<typeof getDb>,
  items: BatchUpsertItem[],
  onProgress?: (done: number, total: number) => void
): Promise<BatchUpsertResult> {
  // Phase 1 – preload existing rows into memory
  const existingRows = db
    .prepare("SELECT id, relative_path, fs_mtime, file_size FROM media")
    .all() as { id: number; relative_path: string; fs_mtime: string; file_size: number }[];
  const existingMap = new Map(existingRows.map((r) => [r.relative_path, r]));

  const toProbe: {
    relativePath: string;
    absolutePath: string;
    folderId: number | null;
    mediaType: string;
    existingId?: number;
    size: number;
    mtimeStr: string;
    isNew: boolean;
  }[] = [];
  let skipped = 0;

  // Phase 1b – stat/classify files in parallel batches (within a directory
  // there may be hundreds of entries; parallel stat avoids serial I/O)
  const STAT_CONCURRENCY = 16;
  for (let i = 0; i < items.length; i += STAT_CONCURRENCY) {
    const batch = items.slice(i, i + STAT_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (item) => {
        const ext = getExtension(item.absolutePath);
        if (!isSupported(ext)) return { ok: false as const };
        const mediaType = classifyMediaType(ext);
        if (!mediaType) return { ok: false as const };

        const fileStats = await getFileStats(item.absolutePath);
        if (!fileStats) return { ok: false as const };

        const mtimeStr = fileStats.mtime.toISOString();
        const existing = existingMap.get(item.relativePath);

        if (existing && existing.fs_mtime === mtimeStr && existing.file_size === fileStats.size) {
          return { ok: false as const };
        }

        return {
          ok: true as const,
          item,
          mediaType,
          existingId: existing?.id,
          size: fileStats.size,
          mtimeStr,
          isNew: !existing,
        };
      })
    );

    for (const r of results) {
      if (r.ok) {
        toProbe.push({
          relativePath: r.item.relativePath,
          absolutePath: r.item.absolutePath,
          folderId: r.item.folderId,
          mediaType: r.mediaType,
          existingId: r.existingId,
          size: r.size,
          mtimeStr: r.mtimeStr,
          isNew: r.isNew,
        });
      } else {
        skipped++;
      }
    }
  }

  // Phase 2 – probe metadata in parallel batches
  const CONCURRENCY = 8;
  const probed: (typeof toProbe[0] & { metadata: MediaMetadata | null })[] = [];

  for (let i = 0; i < toProbe.length; i += CONCURRENCY) {
    const batch = toProbe.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (item) => {
        const metadata = await probeMedia(item.absolutePath);
        return { ...item, metadata };
      })
    );
    probed.push(...results);
    onProgress?.(Math.min(i + CONCURRENCY, toProbe.length), toProbe.length);
  }

  // Phase 3 – batch write in a single synchronous transaction
  const insertStmt = db.prepare(
    `INSERT INTO media
      (folder_id, relative_path, filename, mime_type, media_type,
       file_size, width, height, duration_secs, fs_mtime)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const updateStmt = db.prepare(
    `UPDATE media SET
      folder_id = ?, filename = ?, mime_type = ?, media_type = ?,
      file_size = ?, width = ?, height = ?, duration_secs = ?,
      fs_mtime = ?, updated_at = datetime('now')
    WHERE id = ?`
  );

  const transaction = db.transaction(() => {
    for (const item of probed) {
      if (item.existingId) {
        updateStmt.run(
          item.folderId,
          path.basename(item.relativePath),
          item.metadata?.mimeType ?? getMimeType(getExtension(item.absolutePath)),
          item.mediaType,
          item.size,
          item.metadata?.width ?? null,
          item.metadata?.height ?? null,
          item.metadata?.duration_secs ?? null,
          item.mtimeStr,
          item.existingId
        );
      } else {
        const result = insertStmt.run(
          item.folderId,
          item.relativePath,
          path.basename(item.relativePath),
          item.metadata?.mimeType ?? getMimeType(getExtension(item.absolutePath)),
          item.mediaType,
          item.size,
          item.metadata?.width ?? null,
          item.metadata?.height ?? null,
          item.metadata?.duration_secs ?? null,
          item.mtimeStr
        );
        item.existingId = result.lastInsertRowid as number;
      }
    }
  });
  transaction();

  const needsThumbnailGeneration = probed.map((item) => ({
    mediaId: item.existingId!,
    relativePath: item.relativePath,
    mediaType: item.mediaType,
  }));

  return {
    added: probed.filter((p) => p.isNew).length,
    updated: probed.filter((p) => !p.isNew).length,
    skipped,
    needsThumbnailGeneration,
  };
}

/**
 * Batch generates thumbnails and blurhashes for a list of media items.
 * Uses per-media-type concurrency limits:
 *   - animated (GIF): 2  (CPU-bound sharp decoding)
 *   - video: 4           (ffmpeg is mostly I/O bound)
 *   - image: 4           (static sharp, less intensive than animated)
 */
async function generateMediaAssets(
  items: { mediaId: number; relativePath: string; mediaType: string }[],
  onProgress?: (generated: number, total: number) => void
): Promise<{ thumbnails: number; blurhashes: number }> {
  const { thumbRoot } = getConfig();
  if (!fs.existsSync(thumbRoot)) {
    fs.mkdirSync(thumbRoot, { recursive: true });
  }

  // Partition by media type so we can apply different concurrency limits
  const byType: Record<string, typeof items> = {
    animated: [],
    video: [],
    image: [],
  };
  for (const item of items) {
    (byType[item.mediaType] ?? byType.image).push(item);
  }

  const limits: Record<string, number> = {
    animated: 2,
    video: 4,
    image: 4,
  };

  let thumbnailsGenerated = 0;
  let blurhashesGenerated = 0;
  let processed = 0;

  // Process each partition with its own concurrency
  for (const [mediaType, typeItems] of Object.entries(byType)) {
    if (typeItems.length === 0) continue;
    const concurrency = limits[mediaType] ?? 4;

    for (let i = 0; i < typeItems.length; i += concurrency) {
      const batch = typeItems.slice(i, i + concurrency);

      await Promise.all(
        batch.map(async (item) => {
          try {
            // Static thumbs first (grid first paint), then optional motion preview
            const smallThumb = await generateThumbnail(
              item.mediaId,
              item.relativePath,
              item.mediaType,
              "small"
            );
            const largeThumb = await generateThumbnail(
              item.mediaId,
              item.relativePath,
              item.mediaType,
              "large"
            );

            if (supportsMotionPreview(item.mediaType)) {
              await generateMotionThumbnail(
                item.mediaId,
                item.relativePath,
                item.mediaType
              );
            }

            if (smallThumb || largeThumb) {
              thumbnailsGenerated++;
            }

            // Generate blurhash and store in DB
            const blurhash = await generateBlurhashForMedia(item.relativePath, item.mediaType);
            if (blurhash) {
              const db = getDb();
              db.prepare("UPDATE media SET thumb_blurhash = ? WHERE id = ?").run(blurhash, item.mediaId);
              blurhashesGenerated++;
            }
          } catch (err) {
            console.warn(`Failed to generate assets for media ${item.mediaId}:`, err);
          }

          processed++;
          onProgress?.(processed, items.length);
        })
      );
    }
  }

  return { thumbnails: thumbnailsGenerated, blurhashes: blurhashesGenerated };
}

/**
 * Removes media entries for files that no longer exist using a temp table
 * and a single SQL DELETE — avoids loading the entire table into memory.
 */
function removeStaleMedia(
  db: ReturnType<typeof getDb>,
  validPaths: Set<string>
): number {
  if (validPaths.size === 0) {
    const result = db.prepare("DELETE FROM media").run();
    return result.changes;
  }

  db.prepare("CREATE TEMP TABLE IF NOT EXISTS _valid_media_paths (path TEXT PRIMARY KEY)").run();
  db.prepare("DELETE FROM _valid_media_paths").run();

  const insert = db.prepare("INSERT OR IGNORE INTO _valid_media_paths (path) VALUES (?)");
  const tx = db.transaction(() => {
    for (const p of validPaths) {
      insert.run(p);
    }
  });
  tx();

  const result = db.prepare(
    `DELETE FROM media WHERE relative_path NOT IN (SELECT path FROM _valid_media_paths)`
  ).run();

  return result.changes;
}

/**
 * Determines if we're running in a Docker container based on environment.
 * Docker deployments set DATA_ROOT to /data and MEDIA_ROOT to /media.
 */
function isDockerBuild(): boolean {
  return process.env.DATA_ROOT === "/data" && process.env.MEDIA_ROOT === "/media";
}

/**
 * Recursively walks a directory and returns all file paths.
 * Subdirectories are processed in parallel for better performance.
 */
async function walkDir(
  dirPath: string,
  validFolders: Set<string>,
  validFiles: Set<string>
): Promise<void> {
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
  } catch (err) {
    throw new Error(`Failed to read directory: ${dirPath}: ${err instanceof Error ? err.message : String(err)}`);
  }

  const subdirs: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      const relPath = toRelativePath(fullPath);
      if (relPath !== null) {
        validFolders.add(relPath);
        subdirs.push(fullPath);
      }
    } else if (entry.isFile()) {
      const relPath = toRelativePath(fullPath);
      if (relPath !== null) {
        validFiles.add(relPath);
      }
    }
  }

  // Process subdirectories in parallel
  if (subdirs.length > 0) {
    await Promise.all(subdirs.map((subdir) => walkDir(subdir, validFolders, validFiles)));
  }
}

const zeroSummary: ScanSummary = {
  filesFound: 0,
  filesAdded: 0,
  filesUpdated: 0,
  filesRemoved: 0,
  foldersFound: 0,
  foldersAdded: 0,
  foldersRemoved: 0,
  thumbnailsGenerated: 0,
  blurhashesGenerated: 0,
};

/**
 * Runs a full scan of the media library.
 */
export async function runFullScan(): Promise<ScanResult> {
  const { mediaRoot } = getConfig();
  const db = getDb();

  // Atomically check for running scans and create a new one using a transaction
  let scanJobId: number;
  try {
    const transaction = db.transaction(() => {
      const existing = db
        .prepare("SELECT id FROM scan_jobs WHERE status = 'running' LIMIT 1")
        .get();
      if (existing) {
        return false; // Indicate scan already running
      }
      const scanResult = db
        .prepare(
          "INSERT INTO scan_jobs (folder_path, status, started_at) VALUES (?, 'running', datetime('now'))"
        )
        .run(mediaRoot);
      return scanResult.lastInsertRowid as number;
    });
    const result = transaction();
    if (result === false) {
      return { success: false, summary: zeroSummary, error: "A scan is already running" };
    }
    scanJobId = result;
  } catch (err) {
    return { success: false, summary: zeroSummary, error: `Failed to start scan: ${err instanceof Error ? err.message : String(err)}` };
  }

  const summary: ScanSummary = {
    filesFound: 0,
    filesAdded: 0,
    filesUpdated: 0,
    filesRemoved: 0,
    foldersFound: 0,
    foldersAdded: 0,
    foldersRemoved: 0,
    thumbnailsGenerated: 0,
    blurhashesGenerated: 0,
  };

  // In local-default mode (non-Docker, non-production), ensure mediaRoot exists
  // to avoid preflight failures in fresh local development environments
  const useLocalDefaults = !isDockerBuild() && process.env.NODE_ENV !== "production";
  if (useLocalDefaults) {
    await fs.promises.mkdir(mediaRoot, { recursive: true });
  }

  // Preflight: verify mediaRoot is accessible before doing any stale cleanup
  try {
    const stat = await fs.promises.stat(mediaRoot);
    if (!stat.isDirectory()) throw new Error("mediaRoot is not a directory");
    await fs.promises.readdir(mediaRoot);
  } catch (preflightError) {
    const msg = preflightError instanceof Error ? preflightError.message : "Unknown error";
    db.prepare(
      `UPDATE scan_jobs SET status = 'failed', completed_at = datetime('now'), error_message = ? WHERE id = ?`
    ).run(msg, scanJobId);
    return { success: false, summary: zeroSummary, error: `mediaRoot preflight failed: ${msg}` };
  }

  try {
    // Walk the media directory
    const validFolders = new Set<string>();
    const validFiles = new Set<string>();

    // Start with root folder
    validFolders.add("");
    await walkDir(mediaRoot, validFolders, validFiles);

    summary.foldersFound = validFolders.size;

    // Build folder hierarchy and track folder ID mappings
    const folderIdMap = new Map<string, number>();
    // First pass: ensure all folders exist
    for (const folderPath of Array.from(validFolders).sort((a, b) => a.length - b.length)) {
      // Normalize "." to "" for root folder consistency
      const normalizedFolderPath = folderPath === "." ? "" : folderPath;
      let parentId: number | null = null;
      if (normalizedFolderPath !== "") {
        const parentPath = path.dirname(normalizedFolderPath) === "." ? "" : (path.dirname(normalizedFolderPath) || "");
        parentId = folderIdMap.get(parentPath) ?? null;
      }
      const { id: folderId, inserted } = upsertFolder(db, normalizedFolderPath, parentId);
      folderIdMap.set(normalizedFolderPath, folderId);
      if (inserted) summary.foldersAdded++;
    }

    // Batch upsert all media files
    const batchItems: BatchUpsertItem[] = [];
    for (const relativePath of validFiles) {
      const absolutePath = path.join(mediaRoot, relativePath);
      const folderPath = path.dirname(relativePath) === "." ? "" : (path.dirname(relativePath) || "");
      const folderId = folderIdMap.get(folderPath) ?? null;
      batchItems.push({ relativePath, absolutePath, folderId });
    }

    summary.filesFound = batchItems.length;

    const batchResult = await batchUpsertFiles(db, batchItems);
    summary.filesAdded = batchResult.added;
    summary.filesUpdated = batchResult.updated;

    // Remove stale entries before marking scan complete
    summary.foldersRemoved = removeStaleFolders(db, validFolders);
    summary.filesRemoved = removeStaleMedia(db, validFiles);

    // Mark scan DB-phase complete and return immediately — thumbnail generation
    // is CPU/I/O heavy and runs in the background so the HTTP response isn't blocked.
    db.prepare(
      `UPDATE scan_jobs SET
        status = 'completed',
        completed_at = datetime('now'),
        files_found = ?, files_added = ?, files_updated = ?, files_removed = ?,
        thumbnails_generated = 0,
        blurhashes_generated = 0
      WHERE id = ?`
    ).run(
      summary.filesFound,
      summary.filesAdded,
      summary.filesUpdated,
      summary.filesRemoved,
      scanJobId
    );

    // Background asset generation: fire-and-forget so the scan HTTP handler
    // returns promptly. The job record is updated when thumbs finish.
    if (batchResult.needsThumbnailGeneration.length > 0) {
      const assetItems = batchResult.needsThumbnailGeneration;
      // Intentionally not awaited — runs after the scan response is sent
      generateMediaAssets(assetItems)
        .then(({ thumbnails, blurhashes }) => {
          db.prepare(
            `UPDATE scan_jobs SET
              thumbnails_generated = ?,
              blurhashes_generated = ?
            WHERE id = ?`
          ).run(thumbnails, blurhashes, scanJobId);
        })
        .catch((err) => {
          console.error("Background thumbnail generation failed:", err);
          db.prepare(
            `UPDATE scan_jobs SET error_message = ? WHERE id = ?`
          ).run(
            `Thumbnail generation failed: ${err instanceof Error ? err.message : String(err)}`,
            scanJobId
          );
        });
    }

    return { success: true, summary };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    db.prepare(
      `UPDATE scan_jobs SET 
        status = 'failed', 
        completed_at = datetime('now'),
        error_message = ?
      WHERE id = ?`
    ).run(errorMessage, scanJobId);

    return { success: false, summary, error: errorMessage };
  }
}

/**
 * Gets recent scan jobs.
 */
export function getRecentScanJobs(limit = 10) {
  const db = getDb();
  return db
    .prepare(
      `SELECT id, folder_path, status, started_at, completed_at, 
              error_message, files_found, files_added, files_updated, files_removed, created_at
       FROM scan_jobs 
       ORDER BY created_at DESC 
       LIMIT ?`
    )
    .all(limit);
}
