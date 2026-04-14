/**
 * Database helpers for folders table.
 */
import { getDb } from "./index";

export interface FolderRow {
  id: number;
  path: string;
  name: string;
  parent_id: number | null;
  manual_order: number;
  created_at: string;
  updated_at: string;
}

/** Get the root folder (path = ''). Returns null if not yet scanned. */
export function getRootFolder(): FolderRow | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM folders WHERE path = ''")
    .get() as FolderRow | undefined;
  return row ?? null;
}

/** Get all folders ordered for tree display. */
export function getAllFolders(): FolderRow[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM folders ORDER BY path")
    .all() as FolderRow[];
}

/** Get a folder by its ID. Returns null if not found. */
export function getFolderById(id: number): FolderRow | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM folders WHERE id = ?")
    .get(id) as FolderRow | undefined;
  return row ?? null;
}

/** Get direct child folders of a given parent folder ID. */
export function getFolderChildren(parentId: number | null): FolderRow[] {
  const db = getDb();
  if (parentId === null) {
    // Root's children are folders with parent_id null and path != ''
    return db
      .prepare("SELECT * FROM folders WHERE parent_id IS NULL AND path != '' ORDER BY name")
      .all() as FolderRow[];
  }
  return db
    .prepare("SELECT * FROM folders WHERE parent_id = ? ORDER BY name")
    .all(parentId) as FolderRow[];
}

/** Get all media items in a folder. */
export function getMediaByFolder(folderId: number | null): import("./media").MediaRow[] {
  const db = getDb();
  if (folderId === null) {
    return db
      .prepare("SELECT * FROM media WHERE folder_id IS NULL ORDER BY filename")
      .all() as import("./media").MediaRow[];
  }
  return db
    .prepare("SELECT * FROM media WHERE folder_id = ? ORDER BY filename")
    .all(folderId) as import("./media").MediaRow[];
}

/** Build breadcrumb trail from root to a given folder ID. */
export function getFolderBreadcrumbs(folderId: number): FolderRow[] {
  const db = getDb();
  const crumbs: FolderRow[] = [];
  let current = db
    .prepare("SELECT * FROM folders WHERE id = ?")
    .get(folderId) as FolderRow | undefined;

  while (current) {
    crumbs.unshift(current);
    if (current.parent_id === null) break;
    current = db
      .prepare("SELECT * FROM folders WHERE id = ?")
      .get(current.parent_id) as FolderRow | undefined;
  }
  return crumbs;
}

/** Check if any folders exist in the database. */
export function hasFolders(): boolean {
  const db = getDb();
  const row = db.prepare("SELECT COUNT(*) as count FROM folders").get() as { count: number };
  return row.count > 0;
}
