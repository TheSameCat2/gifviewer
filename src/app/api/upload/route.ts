import { stat, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { getFolderById } from "@/lib/db/folders";
import { getConfig } from "@/lib/config";
import { isSupported, getMimeType, classifyMediaType } from "@/lib/media/pathing";
import { getDb } from "@/lib/db/index";
import { probeMedia } from "@/lib/media/probe";
import { ensureThumbnail } from "@/lib/media/thumbnails";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  const targetFolderIdStr = formData.get("targetFolderId");
  const targetFolderId = targetFolderIdStr ? Number(targetFolderIdStr) : null;

  if (targetFolderId !== null && (!Number.isInteger(targetFolderId) || targetFolderId <= 0)) {
    return NextResponse.json({ error: "Invalid targetFolderId" }, { status: 400 });
  }

  const targetFolder = targetFolderId !== null ? getFolderById(targetFolderId) : null;

  const { mediaRoot } = getConfig();
  const filename = file.name;
  const ext = path.extname(filename).toLowerCase();

  if (!isSupported(ext)) {
    return NextResponse.json({ error: `Unsupported file type: ${ext}` }, { status: 400 });
  }

  // Determine target directory under mediaRoot
  const targetDir = targetFolder && targetFolder.path !== null ? targetFolder.path : "";
  const targetDirAbs = targetDir ? path.join(mediaRoot, targetDir) : mediaRoot;

  // Ensure target directory exists
  if (!existsSync(targetDirAbs)) {
    await mkdir(targetDirAbs, { recursive: true });
  }

  // Generate unique filename to avoid collisions
  function uniqueFilename(dir: string, baseName: string, extension: string): string {
    let candidate = `${baseName}${extension}`;
    let counter = 1;
    while (existsSync(path.join(mediaRoot, dir, candidate))) {
      candidate = `${baseName} (${counter})${extension}`;
      counter++;
    }
    return candidate;
  }

  const baseName = path.basename(filename, ext);
  const uniqueName = uniqueFilename(targetDir, baseName, ext);
  let relativePath: string;
  if (targetDir) {
    relativePath = `${targetDir}/${uniqueName}`;
  } else {
    relativePath = uniqueName;
  }
  const absPath: string = path.join(mediaRoot, relativePath);

  // Write the file
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  await writeFile(absPath, buffer);

  const fileSize = buffer.length;
  const mimeType = getMimeType(ext);
  const mediaType = classifyMediaType(ext) ?? "image";

  // Probe metadata (images only; videos skip)
  let width: number | null = null;
  let height: number | null = null;
  let durationSecs: number | null = null;

  if (mediaType === "image" || mediaType === "animated") {
    try {
      const meta = await probeMedia(absPath);
      width = meta?.width ?? null;
      height = meta?.height ?? null;
    } catch {
      // Corrupt image; proceed without dimensions
    }
  }

  // Insert into DB
  const db = getDb();
  const maxRow = db.prepare("SELECT MAX(manual_order) as max_order FROM media WHERE folder_id IS ?").get(targetFolderId) as { max_order: number | null } | undefined;
  const nextOrder = (maxRow?.max_order ?? -1) + 1;

  const result = db.prepare(
    `INSERT INTO media (folder_id, relative_path, filename, mime_type, media_type, file_size, width, height, duration_secs, manual_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(targetFolderId, relativePath, uniqueName, mimeType, mediaType, fileSize, width, height, durationSecs, nextOrder);

  const mediaId = Number(result.lastInsertRowid);

  // Generate thumbnail asynchronously (fire and forget)
  const fileStat = await stat(absPath);
  ensureThumbnail(mediaId, relativePath!, mediaType, fileStat.mtime).catch(() => {});

  return NextResponse.json({
    ok: true,
    media: {
      id: mediaId,
      filename: uniqueName,
      relativePath,
      mimeType,
      mediaType,
      fileSize,
      width,
      height,
    },
  });
}
