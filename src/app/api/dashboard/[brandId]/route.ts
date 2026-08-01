/**
 * API: GET /api/dashboard/:brandId
 * 對應 PRD §4.4 + AC-01, AC-02
 */

import { NextRequest, NextResponse } from "next/server";
import { generateDashboardSummary } from "@/lib/dashboard/summary";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ brandId: string }> }
) {
  const { brandId } = await params;
  const days = parseInt(req.nextUrl.searchParams.get("days") ?? "7", 10);

  try {
    const summary = generateDashboardSummary(brandId, days);
    return NextResponse.json(summary);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 404 });
  }
}