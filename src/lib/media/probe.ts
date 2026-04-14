/**
 * Metadata extraction for supported media files.
 * Uses sharp for images/gif, ffprobe for video.
 */
import fs from "fs";
import sharp from "sharp";
import { execFile } from "child_process";
import { promisify } from "util";
import { getExtension, isSupported, classifyMediaType, getMimeType } from "./pathing";

const execFileAsync = promisify(execFile);

export interface MediaMetadata {
  width: number | null;
  height: number | null;
  duration_secs: number | null;
  mimeType: string;
  mediaType: "image" | "animated" | "video";
}

/**
 * Extracts metadata from an image or animated file using sharp.
 */
async function probeImage(filePath: string): Promise<MediaMetadata> {
  const ext = getExtension(filePath);
  const mediaType = classifyMediaType(ext)!;
  const metadata = await sharp(filePath).metadata();
  return {
    width: metadata.width ?? null,
    height: metadata.height ?? null,
    duration_secs: null,
    mimeType: getMimeType(ext),
    mediaType,
  };
}

/**
 * Extracts metadata from a webm video using ffprobe.
 */
async function probeVideo(filePath: string): Promise<MediaMetadata> {
  const ext = getExtension(filePath);
  const mediaType = classifyMediaType(ext)!;
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v",
      "quiet",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      filePath,
    ]);
    const data = JSON.parse(stdout);
    const videoStream = data.streams?.find((s: { codec_type: string }) => s.codec_type === "video");
    const format = data.format;

    return {
      width: videoStream?.width ?? null,
      height: videoStream?.height ?? null,
      duration_secs: format?.duration ? parseFloat(format.duration) : null,
      mimeType: getMimeType(ext),
      mediaType,
    };
  } catch {
    // ffprobe failed - return minimal metadata
    return {
      width: null,
      height: null,
      duration_secs: null,
      mimeType: getMimeType(ext),
      mediaType,
    };
  }
}

/**
 * Extracts metadata from a media file.
 * Returns null if the file is not supported.
 */
export async function probeMedia(filePath: string): Promise<MediaMetadata | null> {
  const ext = getExtension(filePath);
  if (!isSupported(ext)) return null;

  const stat = await fs.promises.stat(filePath);
  if (!stat.isFile()) return null;

  const mediaType = classifyMediaType(ext);
  if (mediaType === "video") {
    return probeVideo(filePath);
  }
  return probeImage(filePath);
}

/**
 * Gets basic file stats without heavy metadata extraction.
 */
export async function getFileStats(
  filePath: string
): Promise<{ size: number; mtime: Date } | null> {
  try {
    const stat = await fs.promises.stat(filePath);
    if (!stat.isFile()) return null;
    return { size: stat.size, mtime: stat.mtime };
  } catch {
    return null;
  }
}
