/**
 * 巴哈姆特 Worker
 * 對應 PRD §3.1 P0-1 (v1 可選,v2 必做 — 對齊 SPEC §6 DoD v1 先不做)
 * Mock 模式
 */

import { mockDb } from "@/lib/db/mock";
import { analyzeMention } from "@/lib/sentiment/analyzer";
import { triggerAlert } from "@/lib/notifier";
import type { Platform } from "@/types";

const BAHAMUT_PLATFORM: Platform = "BAHAMUT";

interface BahamutFetchResult {
  title: string;
  author: string;
  board: string;
  url: string;
  pushCount: number;
  publishedAt: string;
  content?: string;
}

export async function crawlBahamut(brandKeywords: string[]): Promise<BahamutFetchResult[]> {
  const mock: BahamutFetchResult[] = [
    {
      title: `巴哈 ROG 散熱討論串`,
      author: "maxwell",
      board: "ROG",
      url: `https://forum.gamer.com.tw/C.php?bsn=60023&snA=${Date.now()}`,
      pushCount: 33,
      publishedAt: new Date().toISOString(),
      content: "巴哈網友反映 ROG Ally 散熱設計缺陷…",
    },
  ];
  return mock.filter((m) =>
    brandKeywords.some((kw) => m.title.toLowerCase().includes(kw.toLowerCase()))
  );
}

export async function runBahamutWorker(brandId: string) {
  const brand = mockDb.getBrand(brandId);
  if (!brand) throw new Error(`Brand not found: ${brandId}`);
  const crawled = await crawlBahamut(brand.keywords);
  let inserted = 0;
  let alertsTriggered = 0;
  for (const c of crawled) {
    const sentiment = await analyzeMention(c.title, c.content);
    mockDb.insertMention({
      brandId: brand.id,
      platform: BAHAMUT_PLATFORM,
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