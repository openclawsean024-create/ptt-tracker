/**
 * API: POST /api/stripe/checkout
 * 對應 PRD §3.1 P0-6 + AC
 */

import { NextRequest, NextResponse } from "next/server";
import { createCheckoutSession, getPricing } from "@/lib/stripe/checkout";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const plan = body.plan as "PRO_MONTHLY" | "PRO_YEARLY" | "ENTERPRISE";

    if (!plan) {
      return NextResponse.json({ error: "plan 必填 (PRO_MONTHLY | PRO_YEARLY | ENTERPRISE)" }, { status: 400 });
    }

    const session = createCheckoutSession(plan);
    return NextResponse.json({ session, pricing: getPricing()[plan] });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ pricing: getPricing() });
}