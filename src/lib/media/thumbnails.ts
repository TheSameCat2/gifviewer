/**
 * Server-side thumbnail generation for media files.
 * Thumbnails are cached in THUMB_ROOT based on media ID.
 *
 * Variants:
 * - static: first-frame WebP (small/large) — used for grid first paint
 * - motion: short animated WebP preview — loaded on demand (hover / near-viewport)
 */
import fs from "fs";
import path from "path";
import sharp from "sharp";
import { execFile } from "child_process";
import { promisify } from "util";
import { getConfig } from "../config";
import { resolveMediaPath } from "./pathing";
import { blurhashToDataUrl } from "./blurhash";

const execFileAsync = promisify(execFile);

export type ThumbSize = "small" | "large";
export type ThumbVariant = "static" | "motion";

const THUMB_SIZE = 512;
const THUMB_SIZE_SMALL = 160;
const THUMB_QUALITY = 80;
const THUMB_QUALITY_SMALL = 70;

/** Motion previews stay small + short so the grid never downloads full GIFs. */
const MOTION_SIZE = 160;
const MOTION_QUALITY = 55;
const MOTION_MAX_PAGES = 24;
/** Video motion clip: start offset, duration (seconds), fps. */
const MOTION_VIDEO_SS = "0.3";
const MOTION_VIDEO_DURATION = "2.0";
const MOTION_VIDEO_FPS = "8";

// In-memory cache for thumbnail generation failures (5 minute cooldown)
const THUMB_FAIL_COOLDOWN_MS = 5 * 60 * 1000;
const thumbFailureCache = new Map<string, number>();

function failureKey(mediaId: number, variant: ThumbVariant, size: ThumbSize): string {
  return `${mediaId}:${variant}:${size}`;
}

function hasRecentThumbFailure(
  mediaId: number,
  variant: ThumbVariant = "static",
  size: ThumbSize = "large"
): boolean {
  const key = failureKey(mediaId, variant, size);
  const lastFailure = thumbFailureCache.get(key);
  if (lastFailure === undefined) return false;
  if (Date.now() - lastFailure > THUMB_FAIL_COOLDOWN_MS) {
    thumbFailureCache.delete(key);
    return false;
  }
  return true;
}

function recordThumbFailure(
  mediaId: number,
  variant: ThumbVariant = "static",
  size: ThumbSize = "large"
): void {
  thumbFailureCache.set(failureKey(mediaId, variant, size), Date.now());
}

/**
 * Gets the thumbnail cache path for a given media ID, type, size, and variant.
 */
export function getThumbCachePath(
  mediaId: number,
  mediaType: string,
  size: ThumbSize = "large",
  variant: ThumbVariant = "static"
): string {
  const { thumbRoot } = getConfig();
  void mediaType;
  if (variant === "motion") {
    return path.join(thumbRoot, `thumb_${mediaId}_anim.webp`);
  }
  const sizeSuffix = size === "small" ? "_sm" : "";
  return path.join(thumbRoot, `thumb_${mediaId}${sizeSuffix}.webp`);
}

/**
 * Checks if a thumbnail exists and is up-to-date with the source.
 */
export async function isThumbFresh(
  mediaId: number,
  sourceMtime: Date,
  mediaType: string,
  size: ThumbSize = "large",
  variant: ThumbVariant = "static"
): Promise<boolean> {
  const thumbPath = getThumbCachePath(mediaId, mediaType, size, variant);
  try {
    const thumbStat = await fs.promises.stat(thumbPath);
    return thumbStat.mtime >= sourceMtime;
  } catch {
    return false;
  }
}

/**
 * Generates a static thumbnail for an image (jpg, png, webp, avif, gif).
 * For GIF sources, only the first frame is decoded.
 */
async function generateStaticImageThumb(
  srcPath: string,
  destPath: string,
  size: number,
  quality: number,
  isAnimated: boolean = false
): Promise<void> {
  const pipeline = isAnimated
    ? sharp(srcPath, { animated: true, pages: 1 })
    : sharp(srcPath);
  await pipeline
    .resize(size, size, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality })
    .toFile(destPath);
}

/**
 * Generates a short animated WebP preview from a GIF (capped frame count + size).
 * Sharp rejects `pages` greater than the source frame count, so we clamp first.
 */
async function generateMotionGifThumb(srcPath: string, destPath: string): Promise<void> {
  const meta = await sharp(srcPath, { animated: true, pages: -1 }).metadata();
  const totalPages = Math.max(1, meta.pages ?? 1);
  const pages = Math.min(MOTION_MAX_PAGES, totalPages);

  await sharp(srcPath, {
    animated: true,
    pages,
    limitInputPixels: false,
  })
    .resize(MOTION_SIZE, MOTION_SIZE, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({
      quality: MOTION_QUALITY,
      effort: 4,
    })
    .toFile(destPath);
}

/**
 * Generates a short looping animated WebP from a video via ffmpeg.
 */
async function generateMotionVideoThumb(srcPath: string, destPath: string): Promise<boolean> {
  try {
    await execFileAsync("ffmpeg", [
      "-y",
      "-ss",
      MOTION_VIDEO_SS,
      "-t",
      MOTION_VIDEO_DURATION,
      "-i",
      srcPath,
      "-an",
      "-vf",
      `fps=${MOTION_VIDEO_FPS},scale=${MOTION_SIZE}:${MOTION_SIZE}:force_original_aspect_ratio=decrease:flags=lanczos`,
      "-loop",
      "0",
      "-c:v",
      "libwebp",
      "-quality",
      String(MOTION_QUALITY),
      "-compression_level",
      "4",
      destPath,
    ]);
    return fs.existsSync(destPath);
  } catch {
    return false;
  }
}

/**
 * Generates a thumbnail for a webm video using ffmpeg (static poster frame).
 */
async function generateVideoThumb(
  srcPath: string,
  destPath: string,
  size: number
): Promise<boolean> {
  try {
    await execFileAsync("ffmpeg", [
      "-y",
      "-i",
      srcPath,
      "-ss",
      "00:00:00.5",
      "-vframes",
      "1",
      "-vf",
      `scale=${size}:${size}:force_original_aspect_ratio=decrease`,
      "-f",
      "webp",
      "-q:v",
      String(Math.round(THUMB_QUALITY / 10)),
      destPath,
    ]);
    return true;
  } catch {
    return false;
  }
}

export function supportsMotionPreview(mediaType: string): boolean {
  return mediaType === "animated" || mediaType === "video";
}

/**
 * Generates a static thumbnail for a media file by ID.
 */
export async function generateThumbnail(
  mediaId: number,
  relativePath: string,
  mediaType: string,
  size: ThumbSize = "large"
): Promise<string | null> {
  if (hasRecentThumbFailure(mediaId, "static", size)) {
    return null;
  }

  const srcPath = resolveMediaPath(relativePath);
  if (!srcPath) return null;

  const thumbSize = size === "small" ? THUMB_SIZE_SMALL : THUMB_SIZE;
  const thumbQuality = size === "small" ? THUMB_QUALITY_SMALL : THUMB_QUALITY;
  const destPath = getThumbCachePath(mediaId, mediaType, size, "static");

  const { thumbRoot } = getConfig();
  if (!fs.existsSync(thumbRoot)) {
    fs.mkdirSync(thumbRoot, { recursive: true });
  }

  try {
    if (mediaType === "animated") {
      await generateStaticImageThumb(srcPath, destPath, thumbSize, thumbQuality, true);
    } else if (mediaType === "video") {
      const success = await generateVideoThumb(srcPath, destPath, thumbSize);
      if (!success) {
        recordThumbFailure(mediaId, "static", size);
        return null;
      }
    } else {
      await generateStaticImageThumb(srcPath, destPath, thumbSize, thumbQuality);
    }
    return destPath;
  } catch (err) {
    console.error(`Failed to generate thumbnail for media ${mediaId}:`, err);
    recordThumbFailure(mediaId, "static", size);
    return null;
  }
}

/**
 * Generates a short motion preview WebP for animated/video media.
 */
export async function generateMotionThumbnail(
  mediaId: number,
  relativePath: string,
  mediaType: string
): Promise<string | null> {
  if (!supportsMotionPreview(mediaType)) {
    return null;
  }
  if (hasRecentThumbFailure(mediaId, "motion", "small")) {
    return null;
  }

  const srcPath = resolveMediaPath(relativePath);
  if (!srcPath) return null;

  const destPath = getThumbCachePath(mediaId, mediaType, "small", "motion");
  const { thumbRoot } = getConfig();
  if (!fs.existsSync(thumbRoot)) {
    fs.mkdirSync(thumbRoot, { recursive: true });
  }

  try {
    if (mediaType === "animated") {
      await generateMotionGifThumb(srcPath, destPath);
      return destPath;
    }
    if (mediaType === "video") {
      const ok = await generateMotionVideoThumb(srcPath, destPath);
      if (!ok) {
        recordThumbFailure(mediaId, "motion", "small");
        return null;
      }
      return destPath;
    }
    return null;
  } catch (err) {
    console.error(`Failed to generate motion thumb for media ${mediaId}:`, err);
    recordThumbFailure(mediaId, "motion", "small");
    return null;
  }
}

/**
 * Ensures a thumbnail exists, generating it if necessary.
 */
export async function ensureThumbnail(
  mediaId: number,
  relativePath: string,
  mediaType: string,
  sourceMtime: Date,
  size: ThumbSize = "large",
  variant: ThumbVariant = "static"
): Promise<string | null> {
  const thumbPath = getThumbCachePath(mediaId, mediaType, size, variant);

  const isFresh = await isThumbFresh(mediaId, sourceMtime, mediaType, size, variant);
  if (isFresh && fs.existsSync(thumbPath)) {
    return thumbPath;
  }

  if (variant === "motion") {
    return generateMotionThumbnail(mediaId, relativePath, mediaType);
  }
  return generateThumbnail(mediaId, relativePath, mediaType, size);
}

/**
 * Generates a blurhash string from an image buffer.
 */
async function generateBlurhash(srcPath: string, mediaType: string): Promise<string | null> {
  try {
    let pipeline: sharp.Sharp;

    if (mediaType === "video") {
      const { stdout } = await execFileAsync("ffmpeg", [
        "-y",
        "-i",
        srcPath,
        "-ss",
        "00:00:00.1",
        "-vframes",
        "1",
        "-f",
        "image2pipe",
        "-",
      ]);
      pipeline = sharp(Buffer.from(stdout), { animated: false });
    } else if (mediaType === "animated") {
      pipeline = sharp(srcPath, { animated: true, pages: 1 });
    } else {
      pipeline = sharp(srcPath);
    }

    const { data, info } = await pipeline
      .resize(32, 32, { fit: "inside" })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const width = info.width;
    const height = info.height;
    const pixels = new Uint8ClampedArray(data);

    const componentsX = 4;
    const componentsY = 3;

    const values: number[] = [];

    for (let cy = 0; cy < componentsY; cy++) {
      for (let cx = 0; cx < componentsX; cx++) {
        let r = 0,
          g = 0,
          b = 0,
          count = 0;

        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const basis =
              Math.cos((Math.PI * cx * x) / width) * Math.cos((Math.PI * cy * y) / height);
            const idx = (y * width + x) * 4;
            r += pixels[idx] * basis;
            g += pixels[idx + 1] * basis;
            b += pixels[idx + 2] * basis;
            count += Math.abs(basis);
          }
        }

        if (count > 0) {
          values.push(Math.round(r / count));
          values.push(Math.round(g / count));
          values.push(Math.round(b / count));
        } else {
          values.push(128, 128, 128);
        }
      }
    }

    const encoded = values.map((v) => v.toString(16).padStart(2, "0")).join("");
    return `${componentsX},${componentsY},${encoded}`;
  } catch (err) {
    console.warn(`Failed to generate blurhash for ${srcPath}:`, err);
    return null;
  }
}

/**
 * Generates a blurhash for a media file.
 */
export async function generateBlurhashForMedia(
  relativePath: string,
  mediaType: string
): Promise<string | null> {
  const srcPath = resolveMediaPath(relativePath);
  if (!srcPath) return null;
  return generateBlurhash(srcPath, mediaType);
}

/**
 * Server-side: generates a blurhash data URL for quick API response.
 */
export async function generateBlurhashDataUrl(
  relativePath: string,
  mediaType: string
): Promise<string | null> {
  const hash = await generateBlurhashForMedia(relativePath, mediaType);
  if (!hash) return null;
  return blurhashToDataUrl(hash, 32, 32);
}
