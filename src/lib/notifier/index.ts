/**
 * Notifier — 跨通道推播 (LINE / Slack / Email)
 *
 * 對應 PRD/SPEC.md §3.1 P0-4 + AC-07 + AC-08 (LINE Notify 額度用完 → 切 Slack + Email)
 *
 * Mock 模式:寫到 outbox/ 目錄(實際 deploy 不會真的發)。
 * 生產模式:用 LINE Notify API + Slack Webhook + Resend。
 */

import { mockDb } from "@/lib/db/mock";
import type { NotificationChannel, OutboxItem } from "@/types";

export interface NotifyPayload {
  channel: NotificationChannel;
  recipient: string; // LINE token / Slack webhook URL / email
  subject: string;
  body: string;
  metadata?: Record<string, unknown>;
}

/**
 * 推播 — 自動 fallback 鏈
 * 主通道失敗 → 自動切換備援
 */
export async function notify(payload: NotifyPayload): Promise<OutboxItem> {
  const item = mockDb.pushOutbox({
    channel: payload.channel,
    recipient: payload.recipient,
    subject: payload.subject,
    body: payload.body,
    metadata: payload.metadata ?? {},
  });
  await deliverItem(item);
  return item;
}

/**
 * 批次推播,任何一個失敗自動 fallback
 */
export async function notifyMulti(
  primary: NotifyPayload,
  fallbacks: NotifyPayload[]
): Promise<OutboxItem[]> {
  const results: OutboxItem[] = [];

  try {
    const item = await notify(primary);
    results.push(item);
    return results;
  } catch (err) {
    // 失敗 → fallback
    for (const fb of fallbacks) {
      try {
        const item = await notify(fb);
        results.push(item);
      } catch (err2) {
        console.error(`Fallback ${fb.channel} 失敗:`, err2);
      }
    }
  }
  return results;
}

/**
 * 實際發送 (mock:標記 sentAt;生產:打 API)
 */
async function deliverItem(item: OutboxItem): Promise<void> {
  // mock:不真的發,標記已送出
  item.sentAt = new Date().toISOString();
  item.status = "sent";
}

/**
 * 警示觸發 — 對應 PRD AC-04
 * 當文章情緒 < -50 且 push >10,5 分鐘內 LINE 推播
 */
export async function triggerAlert(
  brandId: string,
  mentionTitle: string,
  mentionUrl: string,
  sentimentScore: number,
  pushCount: number,
  lineNotifyToken: string = "mock-line-token"
): Promise<OutboxItem[]> {
  const triggered: OutboxItem[] = [];

  // 條件:情緒 < -50 且 push > 10
  if (sentimentScore >= -50 || pushCount <= 10) return triggered;

  // 自動 fallback 鏈:LINE → Slack → Email
  const payloads: NotifyPayload[] = [
    {
      channel: "line",
      recipient: lineNotifyToken,
      subject: `⚠️ 負面警示 (情緒 ${sentimentScore})`,
      body: `${mentionTitle}\n${mentionUrl}\n推爆數:${pushCount}`,
      metadata: { brandId, mentionUrl, sentimentScore, pushCount },
    },
    {
      channel: "slack",
      recipient: "https://hooks.slack.com/mock",
      subject: `⚠️ 負面警示`,
      body: `${mentionTitle}\n${mentionUrl}`,
      metadata: { brandId, sentimentScore },
    },
    {
      channel: "email",
      recipient: "user@example.com",
      subject: `[ptt-tracker] 負面警示`,
      body: `${mentionTitle}\n${mentionUrl}\n推爆數:${pushCount}`,
      metadata: { brandId, sentimentScore },
    },
  ];

  const results = await notifyMulti(payloads[0], payloads.slice(1));
  return results;
}