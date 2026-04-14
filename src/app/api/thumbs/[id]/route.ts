import { stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import path from "node:path";
import { NextResponse } from "next/server";
import { getMediaById } from "@/lib/db/media";
import { resolveMediaPath } from "@/lib/media/pathing";
import { ensureThumbnail } from "@/lib/media/thumbnails";

function thumbContentType(p: string): string {
  const ext = path.extname(p).toLowerCase();
  if (ext === ".gif") return "image/gif";
  if (ext === ".webp") return "image/webp";
  return "application/octet-stream";
}

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

  let sourceStat;
  try {
    sourceStat = await stat(filePath);
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }

  if (!sourceStat.isFile()) {
    return new NextResponse("Not found", { status: 404 });
  }

  const thumbPath = await ensureThumbnail(
    parsedId,
    row.relative_path,
    row.media_type ?? "image",
    sourceStat.mtime
  );

  if (thumbPath) {
    let thumbStat;
    try {
      thumbStat = await stat(thumbPath);
    } catch {
      // thumb missing after generation — fall through to original
    }
    if (thumbStat?.isFile()) {
      const stream = Readable.toWeb(createReadStream(thumbPath));

      return new Response(stream as unknown as ReadableStream, {
        headers: {
          "Content-Type": thumbContentType(thumbPath),
          "Content-Length": thumbStat.size.toString(),
          "Cache-Control": "private, max-age=300",
        },
      });
    }
  }

  // Fallback: stream original
  const stream = Readable.toWeb(createReadStream(filePath));

  return new Response(stream as unknown as ReadableStream, {
    headers: {
      "Content-Type": row.mime_type ?? "application/octet-stream",
      "Content-Length": sourceStat.size.toString(),
      "Cache-Control": "private, max-age=60",
    },
  });
}
