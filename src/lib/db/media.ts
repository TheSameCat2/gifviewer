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
