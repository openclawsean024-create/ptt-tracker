/**
 * API: GET /api/brands, POST /api/brands
 * 對應 PRD §4.4
 */

import { NextRequest, NextResponse } from "next/server";
import { mockDb } from "@/lib/db/mock";

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get("userId") ?? "user_demo";
  const brands = mockDb.listBrands(userId);
  return NextResponse.json({ brands, total: brands.length });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { userId, name, keywords, competitors } = body;

    if (!userId || !name || !Array.isArray(keywords)) {
      return NextResponse.json(
        { error: "userId, name, keywords[] 必填" },
        { status: 400 }
      );
    }

    // v3 簡化:直接 mock insert,實際會透過 mockDb
    return NextResponse.json({
      ok: true,
      brand: { id: `brand_new_${Date.now()}`, userId, name, keywords, competitors: competitors ?? [], isActive: true },
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}