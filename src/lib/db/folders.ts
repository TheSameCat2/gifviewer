/**
 * Database helpers for folders table.
 */
import { getDb } from "./index";
import { mediaGridSelectSql } from "./media";

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

/** Get all media items in a folder, ordered by manual_order then filename then id. */
export function getMediaByFolder(folderId: number | null): import("./media").MediaRow[] {
  const db = getDb();
  if (folderId === null) {
    return db
      .prepare("SELECT * FROM media WHERE folder_id IS NULL ORDER BY manual_order, filename, id")
      .all() as import("./media").MediaRow[];
  }
  return db
    .prepare("SELECT * FROM media WHERE folder_id = ? ORDER BY manual_order, filename, id")
    .all(folderId) as import("./media").MediaRow[];
}

// Helper: build the WHERE clause and params for folder-scoped media queries
function folderMediaWhere(folderId: number | null): { where: string; params: (number | null)[] } {
  if (folderId === null) {
    return { where: "folder_id IS NULL", params: [] };
  }
  return { where: "folder_id = ?", params: [folderId] };
}

/** Get the count of media items in a folder. */
export function getMediaCountByFolder(folderId: number | null): number {
  const db = getDb();
  const { where, params } = folderMediaWhere(folderId);
  const row = db
    .prepare(`SELECT COUNT(*) as count FROM media WHERE ${where}`)
    .get(...params) as { count: number };
  return row.count;
}

/** Get a paginated slice of media items in a folder, ordered by manual_order then filename then id. */
export function getMediaByFolderPaginated(
  folderId: number | null,
  limit: number,
  offset: number
): import("./media").MediaRow[] {
  const db = getDb();
  const { where, params } = folderMediaWhere(folderId);
  return db
    .prepare(`SELECT * FROM media WHERE ${where} ORDER BY manual_order, filename, id LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as import("./media").MediaRow[];
}

/** Grid-optimized variant: selects only the columns MediaGrid actually needs. */
export function getMediaGridItems(
  folderId: number | null,
  limit: number,
  offset: number
): import("./media").MediaGridItem[] {
  const db = getDb();
  const { where, params } = folderMediaWhere(folderId);
  return db
    .prepare(`SELECT ${mediaGridSelectSql()} FROM media WHERE ${where} ORDER BY manual_order, filename, id LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as import("./media").MediaGridItem[];
}

/** Get the previous and next media IDs adjacent to the given mediaId within a folder.
 *  Uses direct SQL tuple comparison so it never loads all IDs into memory. */
export function getAdjacentMediaIds(
  folderId: number | null,
  mediaId: number
): { previousId: number | null; nextId: number | null } {
  const db = getDb();
  const { where, params } = folderMediaWhere(folderId);

  // Fetch the current row's ordering values (scoped to folder to ensure it belongs)
  const current = db
    .prepare(`SELECT manual_order, filename, id FROM media WHERE ${where} AND id = ?`)
    .get(...params, mediaId) as { manual_order: number; filename: string; id: number } | undefined;
  if (!current) return { previousId: null, nextId: null };

  // Previous: the row with the greatest (manual_order, filename, id) that is strictly less than the current tuple
  const prev = db
    .prepare(
      `SELECT id FROM media WHERE ${where} AND (manual_order < ? OR (manual_order = ? AND filename < ?) OR (manual_order = ? AND filename = ? AND id < ?))
       ORDER BY manual_order DESC, filename DESC, id DESC LIMIT 1`
    )
    .get(...params, current.manual_order, current.manual_order, current.filename, current.manual_order, current.filename, current.id) as
      | { id: number }
      | undefined;

  // Next: the row with the smallest (manual_order, filename, id) that is strictly greater than the current tuple
  const next = db
    .prepare(
      `SELECT id FROM media WHERE ${where} AND (manual_order > ? OR (manual_order = ? AND filename > ?) OR (manual_order = ? AND filename = ? AND id > ?))
       ORDER BY manual_order ASC, filename ASC, id ASC LIMIT 1`
    )
    .get(...params, current.manual_order, current.manual_order, current.filename, current.manual_order, current.filename, current.id) as
      | { id: number }
      | undefined;

  return { previousId: prev?.id ?? null, nextId: next?.id ?? null };
}

/** Compute which page (1-based) the given mediaId belongs to within a folder, or null if not found.
 *  Uses a COUNT(*) subquery so it never loads all IDs into memory. */
export function getMediaPageForFolderItem(
  folderId: number | null,
  mediaId: number,
  pageSize: number
): number | null {
  const db = getDb();
  const { where, params } = folderMediaWhere(folderId);

  // Fetch the current row's ordering values (scoped to folder to ensure it belongs)
  const current = db
    .prepare(`SELECT manual_order, filename, id FROM media WHERE ${where} AND id = ?`)
    .get(...params, mediaId) as { manual_order: number; filename: string; id: number } | undefined;
  if (!current) return null;

  // Count items that sort strictly before this one
  const row = db
    .prepare(
      `SELECT COUNT(*) as cnt FROM media WHERE ${where} AND
       (manual_order < ? OR (manual_order = ? AND filename < ?) OR (manual_order = ? AND filename = ? AND id < ?))`
    )
    .get(...params, current.manual_order, current.manual_order, current.filename, current.manual_order, current.filename, current.id) as
      | { cnt: number }
      | undefined;

  if (!row) return null;
  return Math.floor(row.cnt / pageSize) + 1;
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

// --- Descendant folder IDs via recursive CTE ---

/**
 * Get all descendant folder IDs under a given folder using a recursive CTE.
 * Returns an empty array if the folder has no children.
 */
export function getDescendantFolderIds(folderId: number): number[] {
  const db = getDb();
  const rows = db
    .prepare(`
      WITH RECURSIVE descendants AS (
        SELECT id FROM folders WHERE parent_id = ?
        UNION ALL
        SELECT f.id FROM folders f INNER JOIN descendants d ON f.parent_id = d.id
      )
      SELECT id FROM descendants
    `)
    .all(folderId) as { id: number }[];
  return rows.map((r) => r.id);
}

// --- Tag lookups ---

/** Get all tags ordered by name. */
export function getAllTags(): import("./media").TagRow[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM tags ORDER BY name")
    .all() as import("./media").TagRow[];
}

// --- Search with tag filtering and rating threshold ---

export interface SearchMediaOptions {
  /** Limit results. */
  limit?: number;
  /** Offset for pagination. */
  offset?: number;
  /** Folder ID to search under (includes all descendants). Pass null for root-level only. */
  folderId?: number | null;
  /** Minimum rating threshold (inclusive). 0 = no filter. */
  minRating?: number;
  /** Tag IDs to filter by (media must have ALL of these tags). */
  tagIds?: number[];
}

/**
 * Shared WHERE builder for search queries so grid and full variants stay in sync.
 */
function buildSearchWhere(
  db: ReturnType<typeof getDb>,
  options: SearchMediaOptions
): { where: string; params: (number | string)[] } {
  const { folderId = null, minRating = 0, tagIds } = options;
  const conditions: string[] = [];
  const params: (number | string)[] = [];

  // Folder scope: either a specific folder + descendants or all media
  if (folderId !== null) {
    const folderIds = [folderId, ...getDescendantFolderIds(folderId)];
    const placeholders = folderIds.map(() => "?").join(", ");
    conditions.push(`m.folder_id IN (${placeholders})`);
    params.push(...folderIds);
  }

  // Rating threshold
  if (minRating > 0) {
    conditions.push("m.rating >= ?");
    params.push(minRating);
  }

  // Tag filtering: media must have ALL specified tags
  if (tagIds && tagIds.length > 0) {
    const tagPlaceholders = tagIds.map(() => "?").join(", ");
    conditions.push(`
      m.id IN (
        SELECT mt.media_id FROM media_tags mt
        WHERE mt.tag_id IN (${tagPlaceholders})
        GROUP BY mt.media_id
        HAVING COUNT(DISTINCT mt.tag_id) = ?
      )
    `);
    params.push(...tagIds, tagIds.length);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  return { where, params };
}

/**
 * Search media with optional folder hierarchy scope, rating threshold, and tag filtering.
 * Uses a recursive CTE to include all descendant folders when folderId is set.
 * Returns { items, totalCount } for proper pagination support.
 */
export function searchMedia(options: SearchMediaOptions = {}): { items: import("./media").MediaRow[]; totalCount: number } {
  const db = getDb();
  const { limit = 100, offset = 0 } = options;
  const { where, params } = buildSearchWhere(db, options);

  // Count total matching media
  const countRow = db
    .prepare(`SELECT COUNT(DISTINCT m.id) as count FROM media m ${where}`)
    .get(...params) as { count: number };
  const totalCount = countRow.count;

  // Fetch paginated items
  const items = db
    .prepare(
      `SELECT DISTINCT m.* FROM media m ${where} ORDER BY m.id DESC LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset) as import("./media").MediaRow[];

  return { items, totalCount };
}

/**
 * Grid-optimized search: selects only the columns MediaGrid needs.
 */
export function searchMediaGridItems(options: SearchMediaOptions = {}): { items: import("./media").MediaGridItem[]; totalCount: number } {
  const db = getDb();
  const { limit = 100, offset = 0 } = options;
  const { where, params } = buildSearchWhere(db, options);

  const countRow = db
    .prepare(`SELECT COUNT(DISTINCT m.id) as count FROM media m ${where}`)
    .get(...params) as { count: number };
  const totalCount = countRow.count;

  const items = db
    .prepare(
      `SELECT DISTINCT ${mediaGridSelectSql("m")} FROM media m ${where} ORDER BY m.id DESC LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset) as import("./media").MediaGridItem[];

  return { items, totalCount };
}
