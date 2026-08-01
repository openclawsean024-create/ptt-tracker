/**
 * Threads Worker
 * 對應 PRD §3.1 P0-1 (Threads 官方 API,需 Meta Business 帳號)
 * Mock 模式
 */

import { mockDb } from "@/lib/db/mock";
import { analyzeMention } from "@/lib/sentiment/analyzer";
import { triggerAlert } from "@/lib/notifier";
import type { Platform } from "@/types";

const THREADS_PLATFORM: Platform = "THREADS";

interface ThreadsFetchResult {
  title: string;
  author: string;
  board: string;
  url: string;
  pushCount: number;
  publishedAt: string;
  content?: string;
}

export async function crawlThreads(brandKeywords: string[]): Promise<ThreadsFetchResult[]> {
  const mock: ThreadsFetchResult[] = [
    {
      title: `Threads ZenFone 災情彙整`,
      author: "render_kid",
      board: "tech_threads",
      url: `https://www.threads.net/@user/post/${Date.now()}`,
      pushCount: 15,
      publishedAt: new Date().toISOString(),
      content: "Threads 用戶反映 ZenFone 11 的 Wi-Fi 連線問題…",
    },
  ];
  return mock.filter((m) =>
    brandKeywords.some((kw) => m.title.toLowerCase().includes(kw.toLowerCase()))
  );
}

export async function runThreadsWorker(brandId: string) {
  const brand = mockDb.getBrand(brandId);
  if (!brand) throw new Error(`Brand not found: ${brandId}`);
  const crawled = await crawlThreads(brand.keywords);
  let inserted = 0;
  let alertsTriggered = 0;
  for (const c of crawled) {
    const sentiment = await analyzeMention(c.title, c.content);
    mockDb.insertMention({
      brandId: brand.id,
      platform: THREADS_PLATFORM,
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