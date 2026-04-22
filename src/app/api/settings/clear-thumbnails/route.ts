import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db";
import { generateThumbnail } from "@/lib/media/thumbnails";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface MediaRow {
  id: number;
  relative_path: string;
  media_type: string;
}

/**
 * POST /api/settings/clear-thumbnails
 * Deletes all cached thumbnail files and kicks off background regeneration
 * for every media item in the database.
 */
export async function POST() {
  const { thumbRoot } = getConfig();

  // 1. Delete all cached thumbnail files
  let deletedCount = 0;
  try {
    if (fs.existsSync(thumbRoot)) {
      const entries = fs.readdirSync(thumbRoot);
      for (const entry of entries) {
        if (entry.startsWith("thumb_") && entry.endsWith(".webp")) {
          fs.unlinkSync(path.join(thumbRoot, entry));
          deletedCount++;
        }
      }
    }
  } catch (err) {
    console.error("Failed to clear thumbnail cache:", err);
    return NextResponse.json(
      { success: false, error: "Failed to clear thumbnail cache" },
      { status: 500 }
    );
  }

  // 2. Kick off background regeneration for all media
  const db = getDb();
  const rows = db
    .prepare("SELECT id, relative_path, media_type FROM media")
    .all() as MediaRow[];

  // Fire-and-forget background regeneration
  (async () => {
    const concurrency = 4;
    for (let i = 0; i < rows.length; i += concurrency) {
      const batch = rows.slice(i, i + concurrency);
      await Promise.all(
        batch.map(async (row) => {
          try {
            await generateThumbnail(row.id, row.relative_path, row.media_type, "small");
            await generateThumbnail(row.id, row.relative_path, row.media_type, "large");
          } catch (err) {
            console.warn(`Background thumb regen failed for ${row.id}:`, err);
          }
        })
      );
    }
    console.log(`Background thumbnail regeneration completed for ${rows.length} items`);
  })();

  return NextResponse.json({
    success: true,
    deleted: deletedCount,
    queued: rows.length,
    message: `Cleared ${deletedCount} thumbnails and queued regeneration for ${rows.length} items.`,
  });
}
