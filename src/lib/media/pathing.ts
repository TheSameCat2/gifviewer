/**
 * Path utilities for safe media path resolution.
 * All paths are resolved relative to MEDIA_ROOT to prevent directory traversal.
 */
import path from "path";
import { getConfig } from "../config";

/** Supported static image extensions */
export const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif"]);

/** Supported animated/image-like extension */
export const ANIMATED_EXTENSIONS = new Set([".gif"]);

/** Supported video-like animated extension */
export const VIDEO_EXTENSIONS = new Set([".webm"]);

/** All supported media extensions */
export const SUPPORTED_EXTENSIONS = new Set([
  ...IMAGE_EXTENSIONS,
  ...ANIMATED_EXTENSIONS,
  ...VIDEO_EXTENSIONS,
]);

export type MediaType = "image" | "animated" | "video";

/**
 * Classifies media type based on file extension.
 */
export function classifyMediaType(ext: string): MediaType | null {
  const lower = ext.toLowerCase();
  if (IMAGE_EXTENSIONS.has(lower)) return "image";
  if (ANIMATED_EXTENSIONS.has(lower)) return "animated";
  if (VIDEO_EXTENSIONS.has(lower)) return "video";
  return null;
}

/**
 * Returns MIME type for a given extension.
 */
export function getMimeType(ext: string): string {
  const lower = ext.toLowerCase();
  const map: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".gif": "image/gif",
    ".webm": "video/webm",
  };
  return map[lower] ?? "application/octet-stream";
}

/**
 * Resolves a relative path to an absolute path under MEDIA_ROOT.
 * Returns null if the resolved path escapes MEDIA_ROOT.
 */
export function resolveMediaPath(relativePath: string): string | null {
  const { mediaRoot } = getConfig();
  const resolved = path.resolve(mediaRoot, relativePath);
  // Ensure the resolved path is within mediaRoot
  if (!resolved.startsWith(mediaRoot + path.sep) && resolved !== mediaRoot) {
    return null;
  }
  return resolved;
}

/**
 * Converts an absolute media path to a relative path from MEDIA_ROOT.
 * Normalizes to forward slashes and ensures the path is actually contained.
 */
export function toRelativePath(absolutePath: string): string | null {
  const { mediaRoot } = getConfig();
  const resolved = path.resolve(absolutePath);
  // Must start with mediaRoot followed by a separator (not just a prefix match)
  const prefix = mediaRoot + path.sep;
  if (!resolved.startsWith(prefix) && resolved !== mediaRoot) {
    return null;
  }
  const rel = path.relative(mediaRoot, resolved);
  // Normalize: convert windows backslashes to forward slashes
  // and empty path (root) to empty string
  return rel.replace(/\\/g, "/") || "";
}

/**
 * Gets the file extension from a filename or path.
 */
export function getExtension(filename: string): string {
  const base = path.basename(filename);
  const dotIndex = base.lastIndexOf(".");
  return dotIndex >= 0 ? base.slice(dotIndex).toLowerCase() : "";
}

/**
 * Checks if a file extension is supported.
 */
export function isSupported(ext: string): boolean {
  return SUPPORTED_EXTENSIONS.has(ext.toLowerCase());
}
