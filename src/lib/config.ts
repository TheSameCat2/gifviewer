import path from "path";
import fs from "fs";

export interface AppConfig {
  appName: string;
  mediaRoot: string;
  dataRoot: string;
  dbPath: string;
  thumbRoot: string;
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function resolvePath(val: string | undefined, fallback: string): string {
  return path.resolve(val ?? fallback);
}

/**
 * Determines if we're running in a Docker container based on environment.
 * Docker deployments set DATA_ROOT to /data and MEDIA_ROOT to /media.
 */
function isDockerBuild(): boolean {
  return process.env.DATA_ROOT === "/data" && process.env.MEDIA_ROOT === "/media";
}

/**
 * Gets the project-local data directory for non-Docker development builds.
 * This prevents build-time errors when /data or /media don't exist.
 */
function getLocalDataRoot(): string {
  // Use project-local storage in development to avoid build-time errors
  return path.resolve(process.cwd(), "data");
}

export function loadConfig(): AppConfig {
  // For Docker/production: honor explicit env vars which typically point to /data and /media
  // For local dev: use project-local ./data directory to prevent build failures
  const useLocalDefaults = !isDockerBuild() && process.env.NODE_ENV !== "production";

  const dataRoot = useLocalDefaults
    ? getLocalDataRoot()
    : resolvePath(process.env.DATA_ROOT, "/data");
  const mediaRoot = useLocalDefaults
    ? path.resolve(process.cwd(), "media")
    : resolvePath(process.env.MEDIA_ROOT, "/media");
  const thumbRoot = resolvePath(process.env.THUMB_ROOT, path.join(dataRoot, "thumbnails"));
  const dbPath = process.env.DB_PATH
    ? path.isAbsolute(process.env.DB_PATH)
      ? process.env.DB_PATH
      : path.join(dataRoot, process.env.DB_PATH)
    : path.join(dataRoot, "gifviewer.db");

  // Ensure required directories exist
  ensureDir(dataRoot);
  ensureDir(thumbRoot);
  if (useLocalDefaults) {
    ensureDir(mediaRoot);
  }

  return {
    appName: process.env.APP_NAME ?? "GIF Viewer",
    mediaRoot,
    dataRoot,
    dbPath,
    thumbRoot,
  };
}

// Singleton config instance
let cachedConfig: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (!cachedConfig) {
    cachedConfig = loadConfig();
  }
  return cachedConfig;
}
