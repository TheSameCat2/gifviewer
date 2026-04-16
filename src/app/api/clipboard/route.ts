import { rename, copyFile, unlink } from "node:fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { addToClipboard, getClipboard, clearClipboard, getMediaById } from "@/lib/db/media";
import { getFolderById } from "@/lib/db/folders";
import { resolveMediaPath } from "@/lib/media/pathing";
import { getConfig } from "@/lib/config";
import { uniqueFilename } from "@/lib/fs-utils";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  const items = getClipboard();
  return NextResponse.json({ items });
}

export async function POST(request: Request) {
  let body: { mediaId?: number; operation?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { mediaId, operation } = body;

  if (typeof mediaId !== "number" || !Number.isInteger(mediaId) || mediaId <= 0) {
    return NextResponse.json({ error: "mediaId must be a positive integer" }, { status: 400 });
  }
  if (operation !== "copy" && operation !== "cut") {
    return NextResponse.json({ error: "operation must be 'copy' or 'cut'" }, { status: 400 });
  }

  const media = getMediaById(mediaId);
  if (!media) {
    return NextResponse.json({ error: "Media not found" }, { status: 404 });
  }

  const item = addToClipboard(mediaId, operation);
  return NextResponse.json({ ok: true, item });
}

export async function DELETE() {
  clearClipboard();
  return NextResponse.json({ ok: true });
}

export async function PATCH(request: Request) {
  let body: { action?: string; targetFolderId?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body.action !== "paste") {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  const items = getClipboard();
  if (items.length === 0) {
    return NextResponse.json({ error: "Clipboard is empty" }, { status: 400 });
  }

  const { targetFolderId } = body;
  if (typeof targetFolderId !== "number" || !Number.isInteger(targetFolderId) || targetFolderId <= 0) {
    return NextResponse.json({ error: "targetFolderId must be a positive integer" }, { status: 400 });
  }

  const targetFolder = getFolderById(targetFolderId);
  if (!targetFolder) {
    return NextResponse.json({ error: "Target folder not found" }, { status: 404 });
  }

  const { mediaRoot } = getConfig();
  const db = getDb();
  const results: { mediaId: number; operation: string; ok: boolean; filename?: string; error?: string }[] = [];

  for (const item of items) {
    const sourceAbsPath = resolveMediaPath(item.source_relative_path);
    if (!sourceAbsPath) {
      results.push({ mediaId: item.media_id, operation: item.operation, ok: false, error: "Invalid source path" });
      continue;
    }

    const sourceMedia = getMediaById(item.media_id);
    if (!sourceMedia) {
      results.push({ mediaId: item.media_id, operation: item.operation, ok: false, error: "Media not found in DB" });
      continue;
    }

    const ext = path.extname(sourceMedia.filename);
    const baseName = path.basename(sourceMedia.filename, ext);
    const targetFilename = uniqueFilename(mediaRoot, targetFolder.path, baseName, ext);
    const targetRelativePath = targetFolder.path ? `${targetFolder.path}/${targetFilename}` : targetFilename;
    const targetAbsPath = path.join(mediaRoot, targetRelativePath);

    try {
      if (item.operation === "copy") {
        // Copy the file to the destination
        await copyFile(sourceAbsPath, targetAbsPath);

        // Insert new DB row for the copy within a transaction
        const transaction = db.transaction(() => {
          const maxRow = db.prepare("SELECT MAX(manual_order) as max_order FROM media WHERE folder_id = ?").get(targetFolderId) as { max_order: number | null } | undefined;
          const nextOrder = (maxRow?.max_order ?? -1) + 1;
          db.prepare(
            `INSERT INTO media (folder_id, relative_path, filename, mime_type, media_type, file_size, width, height, duration_secs, manual_order)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(targetFolderId, targetRelativePath, targetFilename, sourceMedia.mime_type, sourceMedia.media_type, sourceMedia.file_size, sourceMedia.width, sourceMedia.height, sourceMedia.duration_secs, nextOrder);
        });
        transaction();

        results.push({ mediaId: item.media_id, operation: "copy", ok: true, filename: targetFilename });
      } else {
        // Cut: move the file
        let moved = false;
        try {
          await rename(sourceAbsPath, targetAbsPath);
          moved = true;
        } catch (err: unknown) {
          const code = (err as { code?: string }).code;
          if (code === "EXDEV") {
            // Cross-device move: copy then delete source
            await copyFile(sourceAbsPath, targetAbsPath);
            await unlink(sourceAbsPath);
            moved = true;
          } else {
            results.push({ mediaId: item.media_id, operation: "cut", ok: false, error: "Failed to move file" });
            continue;
          }
        }

        if (moved) {
          // Update DB within a transaction
          const transaction = db.transaction(() => {
            const maxRow = db.prepare("SELECT MAX(manual_order) as max_order FROM media WHERE folder_id = ?").get(targetFolderId) as { max_order: number | null } | undefined;
            const nextOrder = (maxRow?.max_order ?? -1) + 1;
            db.prepare(
              `UPDATE media SET folder_id = ?, relative_path = ?, filename = ?, manual_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
            ).run(targetFolderId, targetRelativePath, targetFilename, nextOrder, item.media_id);
          });
          transaction();

          results.push({ mediaId: item.media_id, operation: "cut", ok: true, filename: targetFilename });
        }
      }
    } catch (err) {
      results.push({ mediaId: item.media_id, operation: item.operation, ok: false, error: String(err) });
    }
  }

  clearClipboard();
  return NextResponse.json({ ok: true, results });
}
