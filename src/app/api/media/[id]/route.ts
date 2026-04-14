import { open, stat } from "node:fs/promises";
import { NextResponse } from "next/server";
import { getMediaById, updateMediaRating, getTagsForMedia, addMediaTag, removeMediaTag } from "@/lib/db/media";
import { resolveMediaPath } from "@/lib/media/pathing";

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

  const file = await open(filePath, "r");
  const stream = file.readableWebStream();

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

  let body: { action?: string; rating?: number; tag?: string; tagId?: number };
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

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
