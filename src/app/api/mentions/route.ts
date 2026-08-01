/**
 * API: GET /api/mentions
 * 對應 PRD §4.4
 */

import { NextRequest, NextResponse } from "next/server";
import { mockDb } from "@/lib/db/mock";
import type { Platform } from "@/types";

const VALID_PLATFORMS: Platform[] = ["PTT", "DCARD", "THREADS", "BAHAMUT"];

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const brandId = sp.get("brandId");
  const platform = sp.get("platform");
  const days = sp.get("days") ? parseInt(sp.get("days")!, 10) : undefined;
  const limit = sp.get("limit") ? parseInt(sp.get("limit")!, 10) : undefined;

  if (!brandId) {
    return NextResponse.json({ error: "brandId 必填" }, { status: 400 });
  }

  if (platform && !VALID_PLATFORMS.includes(platform as Platform)) {
    return NextResponse.json(
      { error: `platform 必須是 ${VALID_PLATFORMS.join(", ")}` },
      { status: 400 }
    );
  }

  const mentions = mockDb.listMentions({
    brandId,
    platform: (platform as Platform) ?? undefined,
    days,
    limit,
  });

  return NextResponse.json({
    mentions,
    total: mentions.length,
    filters: { brandId, platform, days, limit },
  });
}