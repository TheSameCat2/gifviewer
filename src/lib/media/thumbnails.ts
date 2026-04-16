/**
 * Server-side thumbnail generation for media files.
 * Thumbnails are cached in THUMB_ROOT based on media ID.
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

const THUMB_SIZE = 512;
const THUMB_SIZE_SMALL = 160;
const THUMB_QUALITY = 80;
const THUMB_QUALITY_SMALL = 70;

// In-memory cache for thumbnail generation failures (5 minute cooldown)
const THUMB_FAIL_COOLDOWN_MS = 5 * 60 * 1000;
const thumbFailureCache = new Map<number, number>();

/**
 * Checks if thumbnail generation recently failed for this media ID.
 * Returns true if we should skip generation attempts for the cooldown period.
 */
function hasRecentThumbFailure(mediaId: number): boolean {
  const lastFailure = thumbFailureCache.get(mediaId);
  if (lastFailure === undefined) return false;
  if (Date.now() - lastFailure > THUMB_FAIL_COOLDOWN_MS) {
    thumbFailureCache.delete(mediaId);
    return false;
  }
  return true;
}

/**
 * Records a thumbnail generation failure for cooldown tracking.
 */
function recordThumbFailure(mediaId: number): void {
  thumbFailureCache.set(mediaId, Date.now());
}

/**
 * Gets the thumbnail cache path for a given media ID, type, and size.
 */
export function getThumbCachePath(mediaId: number, mediaType: string, size: "small" | "large" = "large"): string {
  const { thumbRoot } = getConfig();
  // Use .webp for everything except gif which stays as gif
  const ext = mediaType === "animated" ? ".gif" : ".webp";
  const sizeSuffix = size === "small" ? "_sm" : "";
  return path.join(thumbRoot, `thumb_${mediaId}${sizeSuffix}${ext}`);
}

/**
 * Checks if a thumbnail exists and is up-to-date with the source.
 */
export async function isThumbFresh(
  mediaId: number,
  sourceMtime: Date,
  mediaType: string,
  size: "small" | "large" = "large"
): Promise<boolean> {
  const thumbPath = getThumbCachePath(mediaId, mediaType, size);
  try {
    const thumbStat = await fs.promises.stat(thumbPath);
    return thumbStat.mtime >= sourceMtime;
  } catch {
    return false;
  }
}

/**
 * Generates a thumbnail for an image (jpg, png, webp, avif).
 */
async function generateImageThumb(
  srcPath: string,
  destPath: string,
  size: number,
  quality: number
): Promise<void> {
  await sharp(srcPath)
    .resize(size, size, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality })
    .toFile(destPath);
}

/**
 * Generates a thumbnail for a GIF (preserve animation).
 */
async function generateGifThumb(srcPath: string, destPath: string, size: number): Promise<void> {
  // For GIF, resize using sharp but preserve animation
  // sharp will preserve animated input/output for GIF
  await sharp(srcPath, { animated: true })
    .resize(size, size, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .gif()
    .toFile(destPath);
}

/**
 * Generates a thumbnail for a webm video using ffmpeg.
 * Falls back to creating a poster frame.
 */
async function generateVideoThumb(
  srcPath: string,
  destPath: string,
  size: number
): Promise<boolean> {
  // Try to extract a frame from the video
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

/**
 * Generates a thumbnail for a media file by ID.
 * Returns the path to the generated thumbnail.
 */
export async function generateThumbnail(
  mediaId: number,
  relativePath: string,
  mediaType: string,
  size: "small" | "large" = "large"
): Promise<string | null> {
  // Skip if we've recently failed to generate a thumbnail for this media
  if (hasRecentThumbFailure(mediaId)) {
    return null;
  }

  const srcPath = resolveMediaPath(relativePath);
  if (!srcPath) return null;

  const thumbSize = size === "small" ? THUMB_SIZE_SMALL : THUMB_SIZE;
  const thumbQuality = size === "small" ? THUMB_QUALITY_SMALL : THUMB_QUALITY;
  const destPath = getThumbCachePath(mediaId, mediaType, size);

  // Ensure thumbnail dir exists
  const { thumbRoot } = getConfig();
  if (!fs.existsSync(thumbRoot)) {
    fs.mkdirSync(thumbRoot, { recursive: true });
  }

  try {
    if (mediaType === "animated") {
      await generateGifThumb(srcPath, destPath, thumbSize);
    } else if (mediaType === "video") {
      // For video, try to generate a frame thumbnail
      const success = await generateVideoThumb(srcPath, destPath, thumbSize);
      if (!success) {
        // Record failure to avoid repeated attempts
        recordThumbFailure(mediaId);
        // Return null - the route will fall back to streaming original
        return null;
      }
    } else {
      await generateImageThumb(srcPath, destPath, thumbSize, thumbQuality);
    }
    return destPath;
  } catch (err) {
    console.error(`Failed to generate thumbnail for media ${mediaId}:`, err);
    recordThumbFailure(mediaId);
    return null;
  }
}

/**
 * Ensures a thumbnail exists, generating it if necessary.
 * Returns the thumbnail path.
 */
export async function ensureThumbnail(
  mediaId: number,
  relativePath: string,
  mediaType: string,
  sourceMtime: Date,
  size: "small" | "large" = "large"
): Promise<string | null> {
  const thumbPath = getThumbCachePath(mediaId, mediaType, size);

  // Check if thumbnail is fresh
  const isFresh = await isThumbFresh(mediaId, sourceMtime, mediaType, size);
  if (isFresh && fs.existsSync(thumbPath)) {
    return thumbPath;
  }

  // Generate thumbnail
  return generateThumbnail(mediaId, relativePath, mediaType, size);
}

/**
 * Generates a blurhash string from an image buffer.
 */
async function generateBlurhash(srcPath: string, mediaType: string): Promise<string | null> {
  try {
    let buffer: Buffer;

    if (mediaType === "video") {
      // Extract first frame from video
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
      buffer = Buffer.from(stdout);
    } else {
      buffer = await fs.promises.readFile(srcPath);
    }

    // Resize to small for blurhash calculation
    const { data, info } = await sharp(buffer, { animated: false })
      .resize(32, 32, { fit: "inside" })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    // Generate simple blurhash: sample 4x3 components (DCT-based approximation)
    const width = info.width;
    const height = info.height;
    const pixels = new Uint8ClampedArray(data);

    // 4 components wide, 3 height (12 total - 36 values for RGB)
    const componentsX = 4;
    const componentsY = 3;

    const values: number[] = [];

    for (let cy = 0; cy < componentsY; cy++) {
      for (let cx = 0; cx < componentsX; cx++) {
        let r = 0, g = 0, b = 0, count = 0;

        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            // Basis function for this component (DCT basis)
            const basis = Math.cos((Math.PI * cx * x) / width) * Math.cos((Math.PI * cy * y) / height);
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

    // Encode as compact string: width,height,data where data is hex-encoded RGB values
    const encoded = values.map(v => v.toString(16).padStart(2, "0")).join("");
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
