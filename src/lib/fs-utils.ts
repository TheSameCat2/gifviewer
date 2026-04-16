/**
 * Shared filesystem utilities for the media library.
 */
import fs from "fs";
import path from "path";

const { existsSync } = fs;

/**
 * Generates a unique filename within a directory, appending (n) if collisions exist.
 */
export function uniqueFilename(
  rootDir: string,
  dir: string,
  baseName: string,
  ext: string
): string {
  let candidate = `${baseName}${ext}`;
  let counter = 1;
  while (existsSync(path.join(rootDir, dir, candidate))) {
    candidate = `${baseName} (${counter})${ext}`;
    counter++;
  }
  return candidate;
}
