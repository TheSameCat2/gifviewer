import { stat } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import { Readable } from "node:stream";
import path from "path";
import { NextResponse } from "next/server";
import { getMediaById } from "@/lib/db/media";
import { resolveMediaPath } from "@/lib/media/pathing";
import {
  isThumbFresh,
  getThumbCachePath,
  generateThumbnail,
  generateMotionThumbnail,
  supportsMotionPreview,
  type ThumbSize,
  type ThumbVariant,
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

  const url = new URL(request.url);
  const size: ThumbSize = url.searchParams.get("size") === "small" ? "small" : "large";
  const variantParam = url.searchParams.get("variant");
  const variant: ThumbVariant = variantParam === "motion" ? "motion" : "static";

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

  // Motion previews are opt-in and must never fall back to streaming the original
  // (that would thrash the grid with full GIF/video downloads).
  if (variant === "motion") {
    if (!supportsMotionPreview(mediaType)) {
      return new NextResponse("Motion preview not supported", { status: 404 });
    }

    const isFresh = await isThumbFresh(
      parsedId,
      sourceStat.mtime,
      mediaType,
      "small",
      "motion"
    );
    const thumbPath = getThumbCachePath(parsedId, mediaType, "small", "motion");

    if (isFresh && existsSync(thumbPath)) {
      try {
        const thumbStat = await stat(thumbPath);
        if (thumbStat.isFile()) {
          const stream = Readable.toWeb(createReadStream(thumbPath));
          return new Response(stream as unknown as ReadableStream, {
            headers: {
              "Content-Type": thumbContentType(thumbPath),
              "Content-Length": thumbStat.size.toString(),
              "Cache-Control": "public, max-age=86400",
            },
          });
        }
      } catch {
        // fall through to background generate
      }
    }

    const flightKey = `${parsedId}:motion`;
    if (!inFlightThumbs.has(flightKey)) {
      const promise = (async () => {
        try {
          await generateMotionThumbnail(parsedId, row.relative_path, mediaType);
        } catch (err) {
          console.warn(`Background motion thumb failed for ${flightKey}:`, err);
        } finally {
          inFlightThumbs.delete(flightKey);
        }
      })();
      inFlightThumbs.set(flightKey, promise);
    }

    // Client keeps showing the static thumb until motion is ready.
    return new NextResponse("Motion preview generating", { status: 404 });
  }

  // Static path — stream original while generating if missing (existing behavior)
  const isFresh = await isThumbFresh(parsedId, sourceStat.mtime, mediaType, size, "static");
  if (isFresh) {
    const thumbPath = getThumbCachePath(parsedId, mediaType, size, "static");
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

  const stream = Readable.toWeb(createReadStream(filePath));

  const flightKey = `${parsedId}:static:${size}`;
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
