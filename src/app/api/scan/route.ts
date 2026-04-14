import { NextResponse } from "next/server";
import { runFullScan, getRecentScanJobs } from "@/lib/media/scanner";

export const runtime = "nodejs";

export async function GET() {
  const jobs = getRecentScanJobs();
  return NextResponse.json({ jobs });
}

export async function POST() {
  const result = await runFullScan();
  return NextResponse.json(result);
}
