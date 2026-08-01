/**
 * Weekly Report Generator — 對應 PRD §3.1 P0-5
 *
 * Mock:用 Next.js Response 回傳 HTML(預覽),真實版會用 React PDF + Cloudflare R2。
 * 為 v3 production MVP 簡化。
 */

import { mockDb } from "@/lib/db/mock";
import type { DashboardSummary } from "@/types";
import { generateDashboardSummary } from "@/lib/dashboard/summary";

export interface WeeklyReport {
  brandId: string;
  weekStart: string;
  weekEnd: string;
  summary: DashboardSummary;
  htmlContent: string;
  generatedAt: string;
}

function getWeekRange(d: Date = new Date()): { start: Date; end: Date } {
  const end = new Date(d);
  end.setHours(23, 59, 59, 999);
  const start = new Date(d);
  start.setDate(start.getDate() - 6);
  start.setHours(0, 0, 0, 0);
  return { start, end };
}

export function generateWeeklyReport(brandId: string): WeeklyReport {
  const { start, end } = getWeekRange();
  const summary = generateDashboardSummary(brandId, 7);

  const topMentionsHtml = summary.topMentions
    .slice(0, 10)
    .map(
      (m, i) => `
      <li>
        <strong>#${i + 1}</strong> ${m.title}
        <br/>
        <small>${m.platform} / ${m.board} / 推爆 ${m.pushCount} / 情緒 ${m.sentimentScore ?? "N/A"}</small>
        <br/>
        <a href="${m.url}" target="_blank">原文</a>
      </li>`
    )
    .join("");

  const platformBreakdownHtml = Object.entries(summary.platformBreakdown)
    .map(([p, n]) => `<li>${p}: ${n} 篇</li>`)
    .join("");

  const htmlContent = `
<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8" />
  <title>ptt-tracker 週報 — ${summary.brandName}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; max-width: 800px; margin: 32px auto; padding: 0 16px; color: #111; }
    h1 { color: #1d4ed8; }
    h2 { color: #2563eb; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; }
    .meta { color: #6b7280; font-size: 14px; }
    .stat { background: #eff6ff; padding: 12px; border-radius: 8px; margin: 8px 0; }
    ul { padding-left: 20px; }
    li { margin: 8px 0; }
  </style>
</head>
<body>
  <h1>📊 ${summary.brandName} 口碑週報</h1>
  <p class="meta">
    期間:${summary.periodDays} 天<br/>
    生成時間:${summary.generatedAt}<br/>
    涵蓋平台:PTT + Dcard + Threads + 巴哈姆特
  </p>

  <h2>📈 總覽</h2>
  <div class="stat">
    <strong>${summary.totalMentions}</strong> 篇提及 |
    平均情緒分數 <strong>${summary.averageSentiment}</strong>
  </div>

  <h2>📡 平台佔比</h2>
  <ul>${platformBreakdownHtml}</ul>

  <h2>🔥 TOP 10 熱門文章</h2>
  <ol>${topMentionsHtml}</ol>

  <h2>🤖 AI 重點摘要</h2>
  <p>
    ${summary.brandName} 在過去 7 天共有 ${summary.totalMentions} 篇跨平台提及,
    平均情緒分數 ${summary.averageSentiment},
    平台佔比最高為 ${Object.entries(summary.platformBreakdown).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "N/A"}。
  </p>

  <hr/>
  <p class="meta">本週報由 ptt-tracker v3.0 自動生成 · Hermes Agent OpenClaw</p>
</body>
</html>`.trim();

  return {
    brandId,
    weekStart: start.toISOString(),
    weekEnd: end.toISOString(),
    summary,
    htmlContent,
    generatedAt: new Date().toISOString(),
  };
}