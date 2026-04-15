import { stat } from "node:fs/promises";
import { rename, copyFile, unlink } from "node:fs/promises";
import { existsSync, createReadStream } from "node:fs";
import { Readable } from "node:stream";
import path from "node:path";
import { NextResponse } from "next/server";
import { getMediaById, updateMediaRating, getTagsForMedia, addMediaTag, removeMediaTag, updateMediaLocation, moveMediaOneStep, deleteMedia } from "@/lib/db/media";
import { getFolderById } from "@/lib/db/folders";
import { resolveMediaPath } from "@/lib/media/pathing";
import { getConfig } from "@/lib/config";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  const parsedId = Number(id);
  if (!Number.isInteger(parsedId) || parsedId <= 0) {
    return new NextResponse("Invalid id", { status: 400 });
  }

  const row = getMediaById(parsedId);
  if (!row) {
    return new NextResponse("Not found", { status: 404 });
  }

  const filePath = resolveMediaPath(row.relative_path);
  if (!filePath) {
    return new NextResponse("Not found", { status: 404 });
  }

  let fileStat;
  try {
    fileStat = await stat(filePath);
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }

  if (!fileStat.isFile()) {
    return new NextResponse("Not found", { status: 404 });
  }

  const stream = Readable.toWeb(createReadStream(filePath));

  return new Response(stream as unknown as ReadableStream, {
    headers: {
      "Content-Type": row.mime_type ?? "application/octet-stream",
      "Content-Length": fileStat.size.toString(),
      "Cache-Control": "private, max-age=60",
      "Content-Disposition": `inline; filename="${row.filename.replace(/"/g, "_")}"`,
    },
  });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  const parsedId = Number(id);
  if (!Number.isInteger(parsedId) || parsedId <= 0) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const row = getMediaById(parsedId);
  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let body: { action?: string; rating?: number; tag?: string; tagId?: number; targetFolderId?: number; direction?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { action } = body;

  if (action === "setRating") {
    const rating = typeof body.rating === "number" ? body.rating : -1;
    const clamped = Math.max(0, Math.min(5, rating));
    updateMediaRating(parsedId, clamped);
    const tags = getTagsForMedia(parsedId);
    return NextResponse.json({ ok: true, rating: clamped, tags });
  }

  if (action === "addTag") {
    if (typeof body.tag !== "string" || !body.tag.trim()) {
      return NextResponse.json({ error: "tag must be a non-empty string" }, { status: 400 });
    }
    const tags = addMediaTag(parsedId, body.tag);
    return NextResponse.json({ ok: true, tags });
  }

  if (action === "removeTag") {
    if (typeof body.tagId !== "number" || !Number.isInteger(body.tagId) || body.tagId <= 0) {
      return NextResponse.json({ error: "tagId must be a positive integer" }, { status: 400 });
    }
    const tags = removeMediaTag(parsedId, body.tagId);
    return NextResponse.json({ ok: true, tags });
  }

  if (action === "moveMedia") {
    if (typeof body.targetFolderId !== "number" || !Number.isInteger(body.targetFolderId) || body.targetFolderId <= 0) {
      return NextResponse.json({ error: "targetFolderId must be a positive integer" }, { status: 400 });
    }

    const targetFolder = getFolderById(body.targetFolderId);
    if (!targetFolder) {
      return NextResponse.json({ error: "Target folder not found" }, { status: 404 });
    }

    // If already in same folder, return moved: false
    if (row.folder_id === body.targetFolderId) {
      return NextResponse.json({ ok: true, moved: false, folderId: body.targetFolderId, filename: row.filename, relativePath: row.relative_path });
    }

    const { mediaRoot } = getConfig();
    const sourcePath = resolveMediaPath(row.relative_path);
    if (!sourcePath) {
      return NextResponse.json({ error: "Invalid source path" }, { status: 400 });
    }

    // Capture folder path in a local const for use in nested function (TypeScript doesn't narrow through closures)
    const folderPath = targetFolder.path;

    // Build target relative path: folderPath + "/" + filename (or name (n).ext if collision)
    function uniqueFilename(dir: string, baseName: string, ext: string): string {
      let candidate = `${baseName}${ext}`;
      let counter = 1;
      while (existsSync(path.join(mediaRoot, dir, candidate))) {
        candidate = `${baseName} (${counter})${ext}`;
        counter++;
      }
      return candidate;
    }

    const ext = path.extname(row.filename);
    const baseName = path.basename(row.filename, ext);
    const targetFilename = uniqueFilename(folderPath, baseName, ext);
    const targetRelativePath = folderPath ? `${folderPath}/${targetFilename}` : targetFilename;
    const targetAbsPath = path.join(mediaRoot, targetRelativePath);

    let moved = false;
    try {
      await rename(sourcePath, targetAbsPath);
      moved = true;
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === "EXDEV") {
        // Cross-device: copy then unlink
        await copyFile(sourcePath, targetAbsPath);
        await unlink(sourcePath);
        moved = true;
      } else {
        return NextResponse.json({ error: "Failed to move file" }, { status: 500 });
      }
    }

    // Update DB after successful move
    updateMediaLocation(parsedId, body.targetFolderId, targetRelativePath, targetFilename);

    return NextResponse.json({
      ok: true,
      moved,
      folderId: body.targetFolderId,
      filename: targetFilename,
      relativePath: targetRelativePath,
    });
  }

  if (action === "sortMedia") {
    if (typeof body.direction !== "string" || !["earlier", "later"].includes(body.direction)) {
      return NextResponse.json({ error: "direction must be 'earlier' or 'later'" }, { status: 400 });
    }
    const result = moveMediaOneStep(parsedId, body.direction as "earlier" | "later");
    return NextResponse.json({ ok: true, changed: result !== null });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  const parsedId = Number(id);
  if (!Number.isInteger(parsedId) || parsedId <= 0) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const row = getMediaById(parsedId);
  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const deleted = deleteMedia(parsedId);
  if (!deleted) {
    return NextResponse.json({ error: "Failed to delete" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, deleted: { id: parsedId, filename: deleted.filename } });
}
