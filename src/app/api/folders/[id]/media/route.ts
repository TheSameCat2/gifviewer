import { NextRequest, NextResponse } from "next/server";
import { getFolderById, getMediaCountByFolder, getMediaByFolderPaginated } from "@/lib/db/folders";
import { MediaRow } from "@/lib/db/media";
import { PAGE_SIZE } from "@/lib/gallery";

export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;

  // Parse folder ID from params
  const folderId = parseInt(id, 10);
  if (isNaN(folderId) || folderId <= 0) {
    return NextResponse.json({ error: "Invalid folder ID" }, { status: 400 });
  }

  // Validate folder exists
  const folder = getFolderById(folderId);
  if (!folder) {
    return NextResponse.json({ error: "Folder not found" }, { status: 404 });
  }

  // Parse page from search params (default to 1)
  const pageParam = request.nextUrl.searchParams.get("page");
  let page = 1;
  if (pageParam !== null) {
    const parsed = parseInt(pageParam, 10);
    if (!isNaN(parsed) && parsed >= 1) {
      page = parsed;
    }
  }

  const totalCount = getMediaCountByFolder(folderId);
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const clampedPage = Math.min(page, totalPages);
  const offset = (clampedPage - 1) * PAGE_SIZE;

  const items = getMediaByFolderPaginated(folderId, PAGE_SIZE, offset) as MediaRow[];

  return NextResponse.json({
    page: clampedPage,
    pageSize: PAGE_SIZE,
    totalCount,
    totalPages,
    items,
  });
}
