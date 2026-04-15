import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { getConfig } from "../config";

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    const { dbPath } = getConfig();
    // Ensure directory exists
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    initializeSchema(db);
  }
  return db;
}

function initializeSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      parent_id INTEGER REFERENCES folders(id),
      manual_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS media (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL,
      relative_path TEXT NOT NULL UNIQUE,
      filename TEXT NOT NULL,
      mime_type TEXT,
      media_type TEXT,
      file_size INTEGER,
      width INTEGER,
      height INTEGER,
      duration_secs REAL,
      rating INTEGER DEFAULT 0,
      manual_order INTEGER DEFAULT 0,
     fs_mtime TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS media_tags (
      media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
      tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (media_id, tag_id)
    );

    CREATE TABLE IF NOT EXISTS scan_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      folder_path TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      started_at TEXT,
      completed_at TEXT,
      error_message TEXT,
      files_found INTEGER DEFAULT 0,
      files_added INTEGER DEFAULT 0,
      files_updated INTEGER DEFAULT 0,
      files_removed INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_media_folder ON media(folder_id);
    CREATE INDEX IF NOT EXISTS idx_media_mime ON media(mime_type);
    CREATE INDEX IF NOT EXISTS idx_media_type ON media(media_type);
    CREATE INDEX IF NOT EXISTS idx_media_rating ON media(rating);
    CREATE INDEX IF NOT EXISTS idx_folders_parent ON folders(parent_id);
    CREATE INDEX IF NOT EXISTS idx_folders_path ON folders(path);
    CREATE INDEX IF NOT EXISTS idx_scan_jobs_status ON scan_jobs(status);

    CREATE TABLE IF NOT EXISTS clipboard (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      media_id INTEGER REFERENCES media(id) ON DELETE CASCADE,
      operation TEXT NOT NULL CHECK (operation IN ('copy', 'cut')),
      source_folder_id INTEGER,
      source_relative_path TEXT NOT NULL,
      added_at TEXT DEFAULT (datetime('now'))
    );
  `);
}

export interface DbStats {
  folderCount: number;
  mediaCount: number;
  tagCount: number;
  scanJobCount: number;
}

export function getDbStats(): DbStats {
  const database = getDb();
  const folderCount = database
    .prepare("SELECT COUNT(*) as count FROM folders")
    .get() as { count: number };
  const mediaCount = database
    .prepare("SELECT COUNT(*) as count FROM media")
    .get() as { count: number };
  const tagCount = database
    .prepare("SELECT COUNT(*) as count FROM tags")
    .get() as { count: number };
  const scanJobCount = database
    .prepare("SELECT COUNT(*) as count FROM scan_jobs")
    .get() as { count: number };

  return {
    folderCount: folderCount.count,
    mediaCount: mediaCount.count,
    tagCount: tagCount.count,
    scanJobCount: scanJobCount.count,
  };
}
