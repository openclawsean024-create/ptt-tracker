/**
 * PTT Worker — 抓取 PTT 文章
 *
 * 對應 PRD/SPEC.md §3.1 P0-1 (PTT 自建 Python 爬蟲,與 ptt-alertor 共用)
 * 對應 §3.4 AC-01
 *
 * 生產模式:呼叫 PTT Web API + BeautifulSoup
 * Mock 模式:產生假資料
 */

import { mockDb } from "@/lib/db/mock";
import { analyzeMention } from "@/lib/sentiment/analyzer";
import { triggerAlert } from "@/lib/notifier";
import type { Mention, Platform } from "@/types";

const PTT_PLATFORM: Platform = "PTT";

interface PttCrawlResult {
  title: string;
  author: string;
  board: string;
  url: string;
  pushCount: number;
  publishedAt: string;
  content?: string;
}

/**
 * 抓取 PTT 文章
 * 生產模式會呼叫 PTT API,Mock 模式產生假資料
 */
export async function crawlPtt(brandKeywords: string[]): Promise<PttCrawlResult[]> {
  // Mock:產生假資料
  const mock: PttCrawlResult[] = [
    {
      title: `[情報] ASUS ZenFone 11 跌價 NT$5,000`,
      author: "zenfone_fan",
      board: "MobileComm",
      url: `https://www.ptt.cc/bbs/MobileComm/M.${Date.now()}.A.001.html`,
      pushCount: 42,
      publishedAt: new Date().toISOString(),
      content: "ZenFone 11 跌價訊息,CP 值超高,推薦購買!",
    },
  ];
  return mock.filter((m) =>
    brandKeywords.some((kw) => m.title.toLowerCase().includes(kw.toLowerCase()))
  );
}

/**
 * Worker entry — 跑一次掃描並寫入 DB
 */
export async function runPttWorker(brandId: string): Promise<{
  scanned: number;
  inserted: number;
  alertsTriggered: number;
}> {
  const brand = mockDb.getBrand(brandId);
  if (!brand) throw new Error(`Brand not found: ${brandId}`);

  const crawled = await crawlPtt(brand.keywords);

  let inserted = 0;
  let alertsTriggered = 0;

  for (const c of crawled) {
    const sentiment = await analyzeMention(c.title, c.content);

    const newMention = mockDb.insertMention({
      brandId: brand.id,
      platform: PTT_PLATFORM,
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

    // 觸發警示
    const alerts = await triggerAlert(
      brand.id,
      c.title,
      c.url,
      sentiment.score,
      c.pushCount
    );
    alertsTriggered += alerts.length;
  }

  return { scanned: crawled.length, inserted, alertsTriggered };
}