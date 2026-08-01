/**
 * API: GET /api/reports/weekly
 * 對應 PRD §4.4 + AC-05, AC-06
 */

import { NextRequest, NextResponse } from "next/server";
import { generateWeeklyReport } from "@/lib/pdf/weekly-report";

export async function GET(req: NextRequest) {
  const brandId = req.nextUrl.searchParams.get("brandId");
  const format = req.nextUrl.searchParams.get("format") ?? "json"; // json | html

  if (!brandId) {
    return NextResponse.json({ error: "brandId 必填" }, { status: 400 });
  }

  try {
    const report = generateWeeklyReport(brandId);

    if (format === "html") {
      return new NextResponse(report.htmlContent, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    return NextResponse.json(report);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 404 });
  }
}