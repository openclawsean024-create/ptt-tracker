/**
 * API: GET /api/alerts, POST /api/alerts
 */

import { NextRequest, NextResponse } from "next/server";
import { mockDb } from "@/lib/db/mock";

export async function GET(req: NextRequest) {
  const brandId = req.nextUrl.searchParams.get("brandId");
  if (!brandId) return NextResponse.json({ error: "brandId 必填" }, { status: 400 });
  const alerts = mockDb.listAlerts(brandId);
  return NextResponse.json({ alerts });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { brandId, triggerType, threshold, channels } = body;

    if (!brandId || !triggerType || !Array.isArray(channels)) {
      return NextResponse.json(
        { error: "brandId, triggerType, channels[] 必填" },
        { status: 400 }
      );
    }

    const alert = mockDb.insertAlert({
      brandId,
      triggerType,
      threshold: threshold ?? null,
      channels,
      isActive: true,
    });
    return NextResponse.json({ ok: true, alert });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}