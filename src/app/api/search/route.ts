import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getDescendantFolderIds } from "@/lib/db/folders";
import { MediaGridItem, mediaGridSelectSql } from "@/lib/db/media";
import { PAGE_SIZE } from "@/lib/gallery";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;

  // Parse folder ID (empty string = null = library root)
  const folderParam = searchParams.get("folder");
  let folderId: number | null = null;
  if (folderParam !== null && folderParam !== "") {
    const parsed = parseInt(folderParam, 10);
    if (isNaN(parsed) || parsed <= 0) {
      return NextResponse.json({ error: "Invalid folder ID" }, { status: 400 });
    }
    folderId = parsed;
  }

  // Parse tags (comma-separated tag IDs)
  const tagsParam = searchParams.get("tags");
  const tagIds: number[] = [];
  if (tagsParam !== null && tagsParam !== "") {
    for (const t of tagsParam.split(",")) {
      const parsed = parseInt(t.trim(), 10);
      if (!isNaN(parsed) && parsed > 0) {
        tagIds.push(parsed);
      }
    }
  }

  // Parse rating (minimum rating)
  const ratingParam = searchParams.get("rating");
  let minRating = 0;
  if (ratingParam !== null) {
    const parsed = parseInt(ratingParam, 10);
    if (!isNaN(parsed) && parsed >= 0 && parsed <= 5) {
      minRating = parsed;
    }
  }

  // Parse page (default 1)
  const pageParam = searchParams.get("page");
  let page = 1;
  if (pageParam !== null) {
    const parsed = parseInt(pageParam, 10);
    if (!isNaN(parsed) && parsed >= 1) {
      page = parsed;
    }
  }

  const db = getDb();

  // Build conditions and params
  const conditions: string[] = [];
  const params: (number | string)[] = [];

  // Folder scope: include folder + all descendants
  if (folderId !== null) {
    const allFolderIds = [folderId, ...getDescendantFolderIds(folderId)];
    const placeholders = allFolderIds.map(() => "?").join(", ");
    conditions.push(`m.folder_id IN (${placeholders})`);
    params.push(...allFolderIds);
  }

  // Rating threshold
  if (minRating > 0) {
    conditions.push("m.rating >= ?");
    params.push(minRating);
  }

  // Tag filtering: media must have ALL specified tags
  if (tagIds.length > 0) {
    const tagPlaceholders = tagIds.map(() => "?").join(", ");
    conditions.push(`
      m.id IN (
        SELECT mt.media_id FROM media_tags mt
        WHERE mt.tag_id IN (${tagPlaceholders})
        GROUP BY mt.media_id
        HAVING COUNT(DISTINCT mt.tag_id) = ?
      )
    `);
    params.push(...tagIds, tagIds.length);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  // Count total
  const countRow = db
    .prepare(`SELECT COUNT(DISTINCT m.id) as count FROM media m ${whereClause}`)
    .get(...params) as { count: number };
  const totalCount = countRow.count;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const clampedPage = Math.min(page, totalPages);
  const offset = (clampedPage - 1) * PAGE_SIZE;

  // Fetch paginated items (grid-optimized columns only)
  const items = db
    .prepare(
      `SELECT DISTINCT ${mediaGridSelectSql("m")} FROM media m ${whereClause} ORDER BY m.id DESC LIMIT ? OFFSET ?`
    )
    .all(...params, PAGE_SIZE, offset) as MediaGridItem[];

  return NextResponse.json({
    page: clampedPage,
    pageSize: PAGE_SIZE,
    totalCount,
    totalPages,
    items,
  });
}
