/**
 * Database helpers for media table.
 */
import { getDb } from "./index";
import fs from "node:fs";
import path from "node:path";
import { getConfig } from "@/lib/config";
const { existsSync, unlinkSync } = fs;

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
  thumb_blurhash: string | null;
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

export function getAllTags(): TagRow[] {
  const db = getDb();
  return db
    .prepare("SELECT id, name, created_at FROM tags ORDER BY name")
    .all() as TagRow[];
}

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

// --- Move / Sort helpers ---

/** Update media location (folder_id, relative_path, filename, manual_order). Call after physical move succeeds.
 *  Sets manual_order to the end of the destination folder's manual order sequence. */
export function updateMediaLocation(
  mediaId: number,
  folderId: number | null,
  relativePath: string,
  filename: string
): void {
  const db = getDb();

  if (folderId !== null) {
    // Compute next manual_order as MAX + 1 for the target folder
    const maxRow = db
      .prepare("SELECT MAX(manual_order) as max_order FROM media WHERE folder_id = ?")
      .get(folderId) as { max_order: number | null } | undefined;
    const nextOrder = (maxRow?.max_order ?? -1) + 1;

    db.prepare(
      `UPDATE media
       SET folder_id = ?, relative_path = ?, filename = ?, manual_order = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).run(folderId, relativePath, filename, nextOrder, mediaId);
  } else {
    db.prepare(
      `UPDATE media
       SET folder_id = ?, relative_path = ?, filename = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).run(folderId, relativePath, filename, mediaId);
  }
}

/** Get ordered media in a folder using manual_order. Returns empty array if folder_id is null. */
export function getOrderedMediaInFolder(folderId: number): MediaRow[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM media WHERE folder_id = ? ORDER BY manual_order, filename, id")
    .all(folderId) as MediaRow[];
}

/** Normalize manual_order values in a folder to sequential integers starting at 0. Returns updated rows. */
export function normalizeMediaOrder(folderId: number): MediaRow[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT id FROM media WHERE folder_id = ? ORDER BY manual_order, filename, id")
    .all(folderId) as { id: number }[];

  const update = db.prepare("UPDATE media SET manual_order = ? WHERE id = ?");
  const transaction = db.transaction(() => {
    rows.forEach((row, index) => {
      update.run(index, row.id);
    });
  });
  transaction();

  return getOrderedMediaInFolder(folderId);
}

/**
 * Move a media item one step earlier or later within its folder.
 * Returns { previousId, nextId } for the moved item, or null if no-op.
 * If the media has no folder_id, returns null.
 */
export function moveMediaOneStep(
  mediaId: number,
  direction: "earlier" | "later"
): { previousId: number | null; nextId: number | null } | null {
  const db = getDb();
  const media = getMediaById(mediaId);
  if (!media || media.folder_id === null) {
    return null;
  }

  // Normalize first so first-time reorders work even when all manual_order values are 0
  normalizeMediaOrder(media.folder_id);

  const ordered = getOrderedMediaInFolder(media.folder_id);
  const currentIndex = ordered.findIndex((m) => m.id === mediaId);
  if (currentIndex < 0) return null;

  if (direction === "earlier") {
    if (currentIndex === 0) return { previousId: null, nextId: ordered[0]?.id ?? null };
    // Swap manual_order with the previous item
    const prev = ordered[currentIndex - 1];
    const curr = ordered[currentIndex];
    db.prepare("UPDATE media SET manual_order = ? WHERE id = ?").run(prev.manual_order, curr.id);
    db.prepare("UPDATE media SET manual_order = ? WHERE id = ?").run(curr.manual_order, prev.id);
    return {
      previousId: prev.id,
      nextId: ordered[currentIndex + 1]?.id ?? null,
    };
  } else {
    // "later"
    if (currentIndex === ordered.length - 1) {
      return { previousId: ordered[currentIndex - 1]?.id ?? null, nextId: null };
    }
    const next = ordered[currentIndex + 1];
    const curr = ordered[currentIndex];
    db.prepare("UPDATE media SET manual_order = ? WHERE id = ?").run(next.manual_order, curr.id);
    db.prepare("UPDATE media SET manual_order = ? WHERE id = ?").run(curr.manual_order, next.id);
    return {
      previousId: ordered[currentIndex - 1]?.id ?? null,
      nextId: next.id,
    };
  }
}

// --- Clipboard helpers ---

export interface ClipboardItem {
  id: number;
  media_id: number;
  operation: "copy" | "cut";
  source_folder_id: number | null;
  source_relative_path: string;
  added_at: string;
}

/** Stage a media item on the clipboard. Clears any existing clipboard items first. */
export function addToClipboard(mediaId: number, operation: "copy" | "cut"): ClipboardItem {
  const db = getDb();
  const media = getMediaById(mediaId);
  if (!media) throw new Error("Media not found");

  db.prepare("DELETE FROM clipboard").run();
  db.prepare("INSERT INTO clipboard (media_id, operation, source_folder_id, source_relative_path) VALUES (?, ?, ?, ?)").run(
    mediaId,
    operation,
    media.folder_id,
    media.relative_path
  );
  const row = db.prepare("SELECT * FROM clipboard WHERE media_id = ?").get(mediaId) as ClipboardItem;
  return row;
}

/** Get all items currently on the clipboard. */
export function getClipboard(): ClipboardItem[] {
  const db = getDb();
  return db.prepare("SELECT * FROM clipboard ORDER BY added_at DESC").all() as ClipboardItem[];
}

/** Clear the entire clipboard. */
export function clearClipboard(): void {
  const db = getDb();
  db.prepare("DELETE FROM clipboard").run();
}

/** Remove a specific item from the clipboard. */
export function removeFromClipboard(mediaId: number): void {
  const db = getDb();
  db.prepare("DELETE FROM clipboard WHERE media_id = ?").run(mediaId);
}

// --- Delete media ---

/** Physically delete a media file from disk and remove it from the DB.
 *  Returns the deleted media row for potential undo, or null if not found. */
export function deleteMedia(mediaId: number): MediaRow | null {
  const db = getDb();
  const media = getMediaById(mediaId);
  if (!media) return null;

  const { mediaRoot } = getConfig();
  const absPath = path.join(mediaRoot, media.relative_path);
  try {
    if (existsSync(absPath)) {
      unlinkSync(absPath);
    }
  } catch {
    // File may already be gone; proceed with DB deletion
  }

  // Also delete thumbnail
  const { thumbRoot } = getConfig();
  const thumbPath = path.join(thumbRoot, `${mediaId}.jpg`);
  try {
    if (existsSync(thumbPath)) {
      unlinkSync(thumbPath);
    }
  } catch {
    // Thumbnail may not exist; that's fine
  }

  db.prepare("DELETE FROM media WHERE id = ?").run(mediaId);
  return media;
}
