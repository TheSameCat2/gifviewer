import { stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import path from "path";
import { NextResponse } from "next/server";
import { getMediaById } from "@/lib/db/media";
import { resolveMediaPath } from "@/lib/media/pathing";
import {
  isThumbFresh,
  getThumbCachePath,
  generateThumbnail,
} from "@/lib/media/thumbnails";

function thumbContentType(p: string): string {
  const ext = path.extname(p).toLowerCase();
  if (ext === ".gif") return "image/gif";
  if (ext === ".webp") return "image/webp";
  return "application/octet-stream";
}

// In-flight background generation tracker to avoid duplicate work
const inFlightThumbs = new Map<string, Promise<void>>();

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  // Check for size parameter (small or large, default large)
  const url = new URL(request.url);
  const size = url.searchParams.get("size") === "small" ? "small" : "large";

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

  const mediaType = row.media_type ?? "image";

  // Check if a fresh thumbnail already exists
  const isFresh = await isThumbFresh(parsedId, sourceStat.mtime, mediaType, size);
  if (isFresh) {
    const thumbPath = getThumbCachePath(parsedId, mediaType, size);
    let thumbStat;
    try {
      thumbStat = await stat(thumbPath);
    } catch {
      // Thumb stat failed unexpectedly — fall through to original
    }
    if (thumbStat?.isFile()) {
      const stream = Readable.toWeb(createReadStream(thumbPath));
      return new Response(stream as unknown as ReadableStream, {
        headers: {
          "Content-Type": thumbContentType(thumbPath),
          "Content-Length": thumbStat.size.toString(),
          "Cache-Control": "public, max-age=86400",
        },
      });
    }
  }

  // Stream the original immediately so the browser never waits on generation
  const stream = Readable.toWeb(createReadStream(filePath));

  // Kick off background thumbnail generation if not already in flight
  const flightKey = `${parsedId}:${size}`;
  if (!inFlightThumbs.has(flightKey)) {
    const promise = (async () => {
      try {
        await generateThumbnail(parsedId, row.relative_path, mediaType, size);
      } catch (err) {
        console.warn(`Background thumb generation failed for ${flightKey}:`, err);
      } finally {
        inFlightThumbs.delete(flightKey);
      }
    })();
    inFlightThumbs.set(flightKey, promise);
  }

  return new Response(stream as unknown as ReadableStream, {
    headers: {
      "Content-Type": row.mime_type ?? "application/octet-stream",
      "Content-Length": sourceStat.size.toString(),
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
