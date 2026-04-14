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

export interface ScanSummary {
  filesFound: number;
  filesAdded: number;
  filesUpdated: number;
  filesRemoved: number;
  foldersFound: number;
  foldersAdded: number;
  foldersRemoved: number;
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
 * Deletes folders that no longer exist on disk (except root).
 */
function removeStaleFolders(db: ReturnType<typeof getDb>, validPaths: Set<string>): number {
  const allFolders = db
    .prepare("SELECT id, path FROM folders")
    .all() as { id: number; path: string }[];

  let removed = 0;
  for (const folder of allFolders) {
    if (folder.path !== "" && !validPaths.has(folder.path)) {
      db.prepare("DELETE FROM folders WHERE id = ?").run(folder.id);
      removed++;
    }
  }
  return removed;
}

/**
 * Upserts a media file into the database.
 */
async function upsertMedia(
  db: ReturnType<typeof getDb>,
  folderId: number | null,
  absolutePath: string,
  relativePath: string
): Promise<"added" | "updated" | "skipped"> {
  const ext = getExtension(absolutePath);
  if (!isSupported(ext)) return "skipped";

  const mediaType = classifyMediaType(ext);
  if (!mediaType) return "skipped";

  const fileStats = await getFileStats(absolutePath);
  if (!fileStats) return "skipped";

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
      return "skipped";
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
    return "updated";
  }

  // Insert new
  const metadata = await probeMedia(absolutePath);
  db.prepare(
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
  return "added";
}

/**
 * Removes media entries for files that no longer exist.
 */
function removeStaleMedia(
  db: ReturnType<typeof getDb>,
  validPaths: Set<string>
): number {
  const allMedia = db
    .prepare("SELECT id, relative_path FROM media")
    .all() as { id: number; relative_path: string }[];

  let removed = 0;
  for (const media of allMedia) {
    if (!validPaths.has(media.relative_path)) {
      db.prepare("DELETE FROM media WHERE id = ?").run(media.id);
      removed++;
    }
  }
  return removed;
}

/**
 * Recursively walks a directory and returns all file paths.
 */
async function walkDir(
  dirPath: string,
  validFolders: Set<string>,
  validFiles: Set<string>
): Promise<void> {
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      const relPath = toRelativePath(fullPath);
      if (relPath !== null) {
        validFolders.add(relPath);
        await walkDir(fullPath, validFolders, validFiles);
      }
    } else if (entry.isFile()) {
      const relPath = toRelativePath(fullPath);
      if (relPath !== null) {
        validFiles.add(relPath);
      }
    }
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
};

/**
 * Runs a full scan of the media library.
 */
export async function runFullScan(): Promise<ScanResult> {
  const { mediaRoot } = getConfig();
  const db = getDb();

  // Prevent overlapping scans
  const existing = db
    .prepare("SELECT id FROM scan_jobs WHERE status = 'running' LIMIT 1")
    .get();
  if (existing) {
    return { success: false, summary: zeroSummary, error: "A scan is already running" };
  }

  // Create scan job
  const scanResult = db
    .prepare(
      "INSERT INTO scan_jobs (folder_path, status, started_at) VALUES (?, 'running', datetime('now'))"
    )
    .run(mediaRoot);
  const scanJobId = scanResult.lastInsertRowid as number;

  const summary: ScanSummary = {
    filesFound: 0,
    filesAdded: 0,
    filesUpdated: 0,
    filesRemoved: 0,
    foldersFound: 0,
    foldersAdded: 0,
    foldersRemoved: 0,
  };

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
      const status = await upsertMedia(db, folderId, absolutePath, relativePath);
      if (status === "added") summary.filesAdded++;
      else if (status === "updated") summary.filesUpdated++;
    }

    // Remove stale entries
    summary.foldersRemoved = removeStaleFolders(db, validFolders);
    summary.filesRemoved = removeStaleMedia(db, validFiles);

    // Mark scan complete
    db.prepare(
      `UPDATE scan_jobs SET 
        status = 'completed', 
        completed_at = datetime('now'),
        files_found = ?, files_added = ?, files_updated = ?, files_removed = ?
      WHERE id = ?`
    ).run(
      summary.filesFound,
      summary.filesAdded,
      summary.filesUpdated,
      summary.filesRemoved,
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
