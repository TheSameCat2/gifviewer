/**
 * On-demand thumbnail generation for media files.
 * Thumbnails are cached in THUMB_ROOT based on media ID.
 */
import fs from "fs";
import path from "path";
import sharp from "sharp";
import { execFile } from "child_process";
import { promisify } from "util";
import { getConfig } from "../config";
import { resolveMediaPath } from "./pathing";

const execFileAsync = promisify(execFile);

const THUMB_SIZE = 512;

/**
 * Gets the thumbnail cache path for a given media ID and type.
 */
export function getThumbCachePath(mediaId: number, mediaType: string): string {
  const { thumbRoot } = getConfig();
  // Use .webp for everything except gif which stays as gif
  const ext = mediaType === "animated" ? ".gif" : ".webp";
  return path.join(thumbRoot, `thumb_${mediaId}${ext}`);
}

/**
 * Checks if a thumbnail exists and is up-to-date with the source.
 */
export async function isThumbFresh(
  mediaId: number,
  sourceMtime: Date,
  mediaType: string
): Promise<boolean> {
  const thumbPath = getThumbCachePath(mediaId, mediaType);
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
  destPath: string
): Promise<void> {
  await sharp(srcPath)
    .resize(THUMB_SIZE, THUMB_SIZE, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 80 })
    .toFile(destPath);
}

/**
 * Generates a thumbnail for a GIF (preserve animation).
 */
async function generateGifThumb(srcPath: string, destPath: string): Promise<void> {
  // For GIF, resize using sharp but preserve animation
  // sharp will preserve animated input/output for GIF
  await sharp(srcPath, { animated: true })
    .resize(THUMB_SIZE, THUMB_SIZE, {
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
  destPath: string
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
      `scale=${THUMB_SIZE}:${THUMB_SIZE}:force_original_aspect_ratio=decrease`,
      "-f",
      "webp",
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
  mediaType: string
): Promise<string | null> {
  const srcPath = resolveMediaPath(relativePath);
  if (!srcPath) return null;

  const destPath = getThumbCachePath(mediaId, mediaType);

  // Ensure thumbnail dir exists
  const { thumbRoot } = getConfig();
  if (!fs.existsSync(thumbRoot)) {
    fs.mkdirSync(thumbRoot, { recursive: true });
  }

  try {
    if (mediaType === "animated") {
      await generateGifThumb(srcPath, destPath);
    } else if (mediaType === "video") {
      // For video, try to generate a frame thumbnail
      const success = await generateVideoThumb(srcPath, destPath);
      if (!success) {
        // Return null - the route will fall back to streaming original
        return null;
      }
    } else {
      await generateImageThumb(srcPath, destPath);
    }
    return destPath;
  } catch (err) {
    console.error(`Failed to generate thumbnail for media ${mediaId}:`, err);
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
  sourceMtime: Date
): Promise<string | null> {
  const thumbPath = getThumbCachePath(mediaId, mediaType);

  // Check if thumbnail is fresh
  const isFresh = await isThumbFresh(mediaId, sourceMtime, mediaType);
  if (isFresh && fs.existsSync(thumbPath)) {
    return thumbPath;
  }

  // Generate thumbnail
  return generateThumbnail(mediaId, relativePath, mediaType);
}
