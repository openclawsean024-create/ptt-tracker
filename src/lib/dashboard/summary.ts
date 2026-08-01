/**
 * Dashboard Summary — 對應 PRD §3.1 P0-3 + AC-01, AC-02
 * 計算單一品牌的跨平台 dashboard 資料
 */

import { mockDb } from "@/lib/db/mock";
import type { DashboardSummary, Platform } from "@/types";

export function generateDashboardSummary(
  brandId: string,
  periodDays: number = 7
): DashboardSummary {
  const brand = mockDb.getBrand(brandId);
  if (!brand) throw new Error(`Brand not found: ${brandId}`);

  const mentions = mockDb.listMentions({ brandId, days: periodDays });

  // 平台佔比
  const platformBreakdown: Record<Platform, number> = {
    PTT: 0,
    DCARD: 0,
    THREADS: 0,
    BAHAMUT: 0,
  };
  for (const m of mentions) {
    platformBreakdown[m.platform]++;
  }

  // 平均情緒
  const scored = mentions.filter((m) => m.sentimentScore !== null);
  const averageSentiment =
    scored.length > 0
      ? Math.round(
          scored.reduce((sum, m) => sum + (m.sentimentScore ?? 0), 0) / scored.length
        )
      : 0;

  // 趨勢(每日平均)
  const trendMap = new Map<string, { sum: number; count: number }>();
  for (const m of mentions) {
    const day = m.publishedAt.slice(0, 10);
    const cur = trendMap.get(day) ?? { sum: 0, count: 0 };
    cur.sum += m.sentimentScore ?? 0;
    cur.count += 1;
    trendMap.set(day, cur);
  }
  const sentimentTrend = Array.from(trendMap.entries())
    .map(([date, { sum, count }]) => ({
      date,
      score: Math.round(sum / count),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Top mentions(依推爆數)
  const topMentions = [...mentions]
    .sort((a, b) => b.pushCount - a.pushCount)
    .slice(0, 10);

  return {
    brandId,
    brandName: brand.name,
    periodDays,
    totalMentions: mentions.length,
    platformBreakdown,
    averageSentiment,
    topMentions,
    sentimentTrend,
    generatedAt: new Date().toISOString(),
  };
}