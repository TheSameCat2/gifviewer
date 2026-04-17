import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { TagRow } from "@/lib/db/media";

export const runtime = "nodejs";

export async function GET(_request: NextRequest) {
  const db = getDb();
  const tags = db
    .prepare("SELECT id, name, created_at FROM tags ORDER BY name")
    .all() as TagRow[];

  return NextResponse.json({ tags });
}
