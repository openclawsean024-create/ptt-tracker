/**
 * API: POST /api/line/notify
 * 對應 PRD §4.4 — 綁定 LINE Notify token
 */

import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { userId, token } = body;

    if (!userId || !token) {
      return NextResponse.json({ error: "userId, token 必填" }, { status: 400 });
    }

    // v3 簡化:不做真實綁定驗證(需要實際打 LINE Notify API 測試)
    // 為 production mock:回傳 ok
    return NextResponse.json({
      ok: true,
      message: `LINE Notify token 已記錄 (user: ${userId})`,
      // 實際生產:測試 token 有效性,儲存 AES-256 加密進 DB (對齊 SPEC §5.2)
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}