/**
 * Dcard Worker
 * 對應 PRD §3.1 P0-1 (Dcard 官方 API + 備援 RSS)
 * Mock 模式
 */

import { mockDb } from "@/lib/db/mock";
import { analyzeMention } from "@/lib/sentiment/analyzer";
import { triggerAlert } from "@/lib/notifier";
import type { Platform } from "@/types";

const DCARD_PLATFORM: Platform = "DCARD";

interface DcardFetchResult {
  title: string;
  author: string;
  board: string;
  url: string;
  pushCount: number;
  publishedAt: string;
  content?: string;
}

export async function crawlDcard(brandKeywords: string[]): Promise<DcardFetchResult[]> {
  const mock: DcardFetchResult[] = [
    {
      title: `Dcard 3C 版 ASUS 筆電討論`,
      author: "jessica2026",
      board: "3C",
      url: `https://www.dcard.tw/f/3c/p/${Date.now()}`,
      pushCount: 28,
      publishedAt: new Date().toISOString(),
      content: "想問大家 ASUS 筆電的維修經驗…",
    },
  ];
  return mock.filter((m) =>
    brandKeywords.some((kw) => m.title.toLowerCase().includes(kw.toLowerCase()))
  );
}

export async function runDcardWorker(brandId: string) {
  const brand = mockDb.getBrand(brandId);
  if (!brand) throw new Error(`Brand not found: ${brandId}`);
  const crawled = await crawlDcard(brand.keywords);

  let inserted = 0;
  let alertsTriggered = 0;
  for (const c of crawled) {
    const sentiment = await analyzeMention(c.title, c.content);
    mockDb.insertMention({
      brandId: brand.id,
      platform: DCARD_PLATFORM,
      board: c.board,
      author: c.author,
      title: c.title,
      url: c.url,
      pushCount: c.pushCount,
      summary: sentiment.summary,
      sentimentScore: sentiment.score,
      publishedAt: c.publishedAt,
    });
    inserted++;
    const alerts = await triggerAlert(brand.id, c.title, c.url, sentiment.score, c.pushCount);
    alertsTriggered += alerts.length;
  }
  return { scanned: crawled.length, inserted, alertsTriggered };
}