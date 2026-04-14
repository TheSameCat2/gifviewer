import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { getDbStats } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  const config = getConfig();
  const stats = getDbStats();

  return NextResponse.json({
    app: config.appName,
    status: "ok",
    roots: {
      media: config.mediaRoot,
      data: config.dataRoot,
      thumb: config.thumbRoot,
    },
    db: {
      path: config.dbPath,
    },
    counts: stats,
  });
}
