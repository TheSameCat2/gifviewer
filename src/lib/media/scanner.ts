/**
 * Media library scanning logic.
 * Recursively walks MEDIA_ROOT, syncs folders and media to SQLite.
 */
import fs from "fs";
import path from "path";
import { getDb } from "../db";
import { getConfig } from "../config";
import { probeMedia, getFileStats } from "./probe";
import {
  isSupported,
  getExtension,
  classifyMediaType,
  getMimeType,
  toRelativePath,
} from "./pathing";
import {
  generateThumbnail,
  generateBlurhashForMedia,
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
 * Deletes folders that no longer exist on disk (except root) using batch operations.
 */
function removeStaleFolders(db: ReturnType<typeof getDb>, validPaths: Set<string>): number {
  const allFolders = db
    .prepare("SELECT id, path FROM folders")
    .all() as { id: number; path: string }[];

  const staleIds = allFolders
    .filter((f) => f.path !== "" && !validPaths.has(f.path))
    .map((f) => f.id);

  if (staleIds.length === 0) return 0;

  // Batch delete in a single transaction
  const placeholders = staleIds.map(() => "?").join(",");
  const transaction = db.transaction(() => {
    db.prepare(`DELETE FROM folders WHERE id IN (${placeholders})`).run(...staleIds);
  });
  transaction();

  return staleIds.length;
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

/**
 * Batch generates thumbnails and blurhashes for a list of media items.
 * Uses concurrency limiting to avoid overwhelming the system.
 */
async function generateMediaAssets(
  items: { mediaId: number; relativePath: string; mediaType: string }[],
  onProgress?: (generated: number, total: number) => void
): Promise<{ thumbnails: number; blurhashes: number }> {
  const { thumbRoot } = getConfig();
  if (!fs.existsSync(thumbRoot)) {
    fs.mkdirSync(thumbRoot, { recursive: true });
  }

  const CONCURRENCY = 4; // Process 4 items at a time
  let thumbnailsGenerated = 0;
  let blurhashesGenerated = 0;
  let processed = 0;

  for (let i = 0; i < items.length; i += CONCURRENCY) {
    const batch = items.slice(i, i + CONCURRENCY);
    
    await Promise.all(
      batch.map(async (item) => {
        try {
          // Generate both small and large thumbnails
          const smallThumb = await generateThumbnail(item.mediaId, item.relativePath, item.mediaType, "small");
          const largeThumb = await generateThumbnail(item.mediaId, item.relativePath, item.mediaType, "large");
          
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

  return { thumbnails: thumbnailsGenerated, blurhashes: blurhashesGenerated };
}

/**
 * Removes media entries for files that no longer exist using batch operations.
 */
function removeStaleMedia(
  db: ReturnType<typeof getDb>,
  validPaths: Set<string>
): number {
  const allMedia = db
    .prepare("SELECT id, relative_path FROM media")
    .all() as { id: number; relative_path: string }[];

  const staleIds = allMedia
    .filter((m) => !validPaths.has(m.relative_path))
    .map((m) => m.id);

  if (staleIds.length === 0) return 0;

  // Batch delete in a single transaction
  const placeholders = staleIds.map(() => "?").join(",");
  const transaction = db.transaction(() => {
    db.prepare(`DELETE FROM media WHERE id IN (${placeholders})`).run(...staleIds);
  });
  transaction();

  return staleIds.length;
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

  // Collect items that need thumbnail generation
  const needsThumbnailGeneration: { mediaId: number; relativePath: string; mediaType: string }[] = [];

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

    // Process media files
    for (const relativePath of validFiles) {
      const absolutePath = path.join(mediaRoot, relativePath);
      // Normalize path.dirname result: "." for root files becomes ""
      const folderPath = path.dirname(relativePath) === "." ? "" : (path.dirname(relativePath) || "");
      const folderId = folderIdMap.get(folderPath) ?? null;

      summary.filesFound++;
      const result = await upsertMedia(db, folderId, absolutePath, relativePath);
      if (result.status === "added") summary.filesAdded++;
      else if (result.status === "updated") summary.filesUpdated++;
      
      // Collect items that need thumbnail generation
      if ((result.status === "added" || result.status === "updated") && result.mediaId && result.mediaType && result.relativePath) {
        needsThumbnailGeneration.push({
          mediaId: result.mediaId,
          relativePath: result.relativePath,
          mediaType: result.mediaType,
        });
      }
    }

    // Batch generate thumbnails and blurhashes
    if (needsThumbnailGeneration.length > 0) {
      const { thumbnails, blurhashes } = await generateMediaAssets(needsThumbnailGeneration);
      summary.thumbnailsGenerated = thumbnails;
      summary.blurhashesGenerated = blurhashes;
    }

    // Remove stale entries
    summary.foldersRemoved = removeStaleFolders(db, validFolders);
    summary.filesRemoved = removeStaleMedia(db, validFiles);

    // Mark scan complete
    db.prepare(
      `UPDATE scan_jobs SET 
        status = 'completed', 
        completed_at = datetime('now'),
        files_found = ?, files_added = ?, files_updated = ?, files_removed = ?,
        thumbnails_generated = ?, blurhashes_generated = ?
      WHERE id = ?`
    ).run(
      summary.filesFound,
      summary.filesAdded,
      summary.filesUpdated,
      summary.filesRemoved,
      summary.thumbnailsGenerated,
      summary.blurhashesGenerated,
      scanJobId
    );

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
