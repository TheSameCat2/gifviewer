import { open, stat } from "node:fs/promises";
import { NextResponse } from "next/server";
import { getMediaById } from "@/lib/db/media";
import { resolveMediaPath } from "@/lib/media/pathing";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

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

  let fileStat;
  try {
    fileStat = await stat(filePath);
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }

  if (!fileStat.isFile()) {
    return new NextResponse("Not found", { status: 404 });
  }

  const file = await open(filePath, "r");
  const stream = file.readableWebStream();

  return new Response(stream as unknown as ReadableStream, {
    headers: {
      "Content-Type": row.mime_type ?? "application/octet-stream",
      "Content-Length": fileStat.size.toString(),
      "Cache-Control": "private, max-age=60",
      "Content-Disposition": `inline; filename="${row.filename.replace(/"/g, "_")}"`,
    },
  });
}
