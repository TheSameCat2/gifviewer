/**
 * Database helpers for media table.
 */
import { getDb } from "./index";

export interface MediaRow {
  id: number;
  folder_id: number | null;
  relative_path: string;
  filename: string;
  mime_type: string | null;
  media_type: string | null;
  file_size: number | null;
  width: number | null;
  height: number | null;
  duration_secs: number | null;
  rating: number;
  manual_order: number;
  fs_mtime: string | null;
  created_at: string;
  updated_at: string;
}

export function getMediaById(id: number): MediaRow | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM media WHERE id = ?")
    .get(id) as MediaRow | undefined;
  return row ?? null;
}

export function listMedia(limit?: number): MediaRow[] {
  const db = getDb();
  if (limit !== undefined) {
    return db
      .prepare("SELECT * FROM media ORDER BY id DESC LIMIT ?")
      .all(limit) as MediaRow[];
  }
  return db.prepare("SELECT * FROM media ORDER BY id DESC").all() as MediaRow[];
}

/** Alias for listMedia, used by media index re-exports. */
export const getAllMedia = listMedia;

// --- Tag support ---

export interface TagRow {
  id: number;
  name: string;
  created_at: string;
}

export function updateMediaRating(id: number, rating: number): void {
  const db = getDb();
  db.prepare("UPDATE media SET rating = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(
    rating,
    id
  );
}

export function getTagsForMedia(mediaId: number): TagRow[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT t.id, t.name, t.created_at
       FROM tags t
       JOIN media_tags mt ON mt.tag_id = t.id
       WHERE mt.media_id = ?
       ORDER BY t.name`
    )
    .all(mediaId) as TagRow[];
}

export function addMediaTag(mediaId: number, tagName: string): TagRow[] {
  const db = getDb();
  const trimmed = tagName.trim();
  if (!trimmed) return getTagsForMedia(mediaId);

  // Insert or reuse tag (UNIQUE COLLATE NOCASE on name column handles case-insensitive reuse)
  db.prepare("INSERT OR IGNORE INTO tags (name) VALUES (?)").run(trimmed);

  // Get the tag id (handles case where a matching tag already exists)
  const tag = db
    .prepare("SELECT id, name, created_at FROM tags WHERE name = ? COLLATE NOCASE")
    .get(trimmed) as TagRow;

  if (tag) {
    db.prepare("INSERT OR IGNORE INTO media_tags (media_id, tag_id) VALUES (?, ?)").run(
      mediaId,
      tag.id
    );
  }

  return getTagsForMedia(mediaId);
}

export function removeMediaTag(mediaId: number, tagId: number): TagRow[] {
  const db = getDb();
  db.prepare("DELETE FROM media_tags WHERE media_id = ? AND tag_id = ?").run(mediaId, tagId);
  return getTagsForMedia(mediaId);
}
