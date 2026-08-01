/**
 * ptt-tracker v3.0 — 核心型別定義
 *
 * 對齊 PRD/SPEC.md §4.3 Prisma schema
 * 涵蓋 User, Brand, Mention, Alert, Notification 等核心模型
 */

export type Platform = "PTT" | "DCARD" | "THREADS" | "BAHAMUT";

export type Plan = "FREE" | "PRO_MONTHLY" | "PRO_YEARLY" | "ENTERPRISE";

export type AlertTriggerType =
  | "negative_sentiment"
  | "high_push"
  | "keyword_match";

export type NotificationChannel = "line" | "slack" | "email";

export type NotificationStatus = "pending" | "sent" | "failed";

export interface User {
  id: string;
  email: string;
  companyName: string | null;
  plan: Plan;
  trialEndsAt: string | null;
  createdAt: string;
}

export interface Brand {
  id: string;
  userId: string;
  name: string;
  keywords: string[];
  competitors: string[];
  isActive: boolean;
}

export interface Mention {
  id: string;
  brandId: string;
  platform: Platform;
  board: string;
  author: string;
  title: string;
  url: string;
  pushCount: number;
  summary: string | null;
  sentimentScore: number | null;
  publishedAt: string;
  scrapedAt: string;
}

export interface Alert {
  id: string;
  brandId: string;
  triggerType: AlertTriggerType;
  threshold: number | null;
  channels: NotificationChannel[];
  isActive: boolean;
}

export interface Notification {
  id: string;
  userId: string;
  mentionId: string;
  channel: NotificationChannel;
  status: NotificationStatus;
  sentAt: string;
}

export interface DashboardSummary {
  brandId: string;
  brandName: string;
  periodDays: number;
  totalMentions: number;
  platformBreakdown: Record<Platform, number>;
  averageSentiment: number;
  topMentions: Mention[];
  sentimentTrend: Array<{ date: string; score: number }>;
  generatedAt: string;
}

export interface OutboxItem {
  id: string;
  channel: NotificationChannel;
  recipient: string;
  subject: string;
  body: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  sentAt: string | null;
  status: NotificationStatus;
}

export interface SentimentResult {
  score: number; // -100 ~ +100
  label: "positive" | "neutral" | "negative";
  summary: string;
  confidence: number; // 0 ~ 1
}