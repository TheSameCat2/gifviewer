import { NextResponse } from "next/server";
import {
  startScan,
  pauseScan,
  resumeScan,
  getRecentScanJobs,
} from "@/lib/media/scanner";
import { getActiveScanJob } from "@/lib/media/scan-control";

export const runtime = "nodejs";

export async function GET() {
  const active = getActiveScanJob();
  const jobs = getRecentScanJobs();
  return NextResponse.json({ active, jobs });
}

export async function POST(request: Request) {
  let action = "start";
  try {
    const body = await request.json().catch(() => null);
    if (body && typeof body.action === "string") {
      action = body.action;
    }
  } catch {
    // empty body → start
  }

  if (action === "pause") {
    const result = pauseScan();
    return NextResponse.json({ ...result, active: getActiveScanJob() });
  }

  if (action === "resume") {
    const result = resumeScan();
    return NextResponse.json({ ...result, active: getActiveScanJob() });
  }

  // default: start
  const result = startScan();
  return NextResponse.json({
    ...result,
    active: getActiveScanJob(),
  });
}
