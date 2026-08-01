/**
 * API: POST /api/scan (觸發跨平台 worker 跑一次)
 * 對應 PRD §3.1 P0-1 + AC-01 (每 5 分鐘掃 4 平台)
 */

import { NextRequest, NextResponse } from "next/server";
import { runAllWorkers } from "@/workers/aggregator";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const brandId = body.brandId ?? "brand_asus";
    const result = await runAllWorkers(brandId);
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}