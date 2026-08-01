/**
 * ptt-tracker v3.0 — Mock Data Store (取代 Prisma)
 *
 * 因為這是 v3.0 第一次 production 部署,使用 in-memory mock data store。
 * 升級到真實 Supabase 時,只需要替換這個檔案的 export,API routes 不變。
 *
 * 對應 PRD/SPEC.md §4.3 Prisma schema
 */

import type {
  Brand,
  Mention,
  Alert,
  Notification,
  User,
  Platform,
  OutboxItem,
} from "@/types";

const now = () => new Date().toISOString();

// ===== Users =====
const users: User[] = [
  {
    id: "user_demo",
    email: "demo@ptt-tracker.app",
    companyName: "Demo 行銷公司",
    plan: "PRO_MONTHLY",
    trialEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    createdAt: "2026-07-01T00:00:00.000Z",
  },
];

// ===== Brands =====
const brands: Brand[] = [
  {
    id: "brand_asus",
    userId: "user_demo",
    name: "ASUS",
    keywords: ["ASUS", "華碩", "ZenFone", "ROG"],
    competitors: ["Acer", "MSI", "Razer"],
    isActive: true,
  },
  {
    id: "brand_sean",
    userId: "user_demo",
    name: "Sean 個人品牌",
    keywords: ["Sean", "Hermes Agent", "MiniMax"],
    competitors: [],
    isActive: true,
  },
];

// ===== Mentions (mock 跨平台資料) =====
function makeMockMentions(): Mention[] {
  const platforms: Platform[] = ["PTT", "DCARD", "THREADS", "BAHAMUT"];
  const boards = ["Tech_Job", "MobileComm", "nb-shopping", "3C", "女孩版", "美妝版"];
  const authors = ["tech_fan", "jessica2026", "render_kid", "lohas_p", "maxwell"];
  const titles = [
    "ASUS ZenFone 11 開箱心得",
    "ROG Ally 跌價到 NT$18,990 值得入手嗎？",
    "華碩客服這次處理態度真的讓人失望",
    "Threads 上看到的 ZenFone 災情彙整",
    "Dcard 美妝版 ASUS 筆電討論串",
    "巴哈姆特 ROG 討論區：散熱問題",
    "ZenFone vs iPhone 16 比較",
  ];
  const sentiments = [85, 62, -78, -45, 70, 35, 88, -65, 50, 72];
  const summaries = [
    "使用者對 ZenFone 11 的續航力給予高度肯定。",
    "討論 ROG Ally 跌價後的 CP 值,普遍認為值得入手。",
    "批評華碩客服處理 RMA 流程過慢。",
    "Threads 用戶分享 ZenFone 的 Wi-Fi 連線問題。",
    "Dcard 美妝版網友詢問 ASUS 筆電修圖效能。",
    "巴哈網友反映 ROG Ally 散熱設計缺陷。",
    "規格面 ZenFone 在同價位帶與 iPhone 16 互有勝負。",
  ];
  const urls = [
    "https://www.ptt.cc/bbs/MobileComm/M.1722345600.A.DEF.html",
    "https://www.dcard.tw/f/3c/p/123456",
    "https://www.threads.net/@user/post/Cabcdef",
    "https://forum.gamer.com.tw/C.php?bsn=60023&snA=12345",
  ];

  const out: Mention[] = [];
  for (let i = 0; i < 28; i++) {
    const platform = platforms[i % platforms.length];
    const publishedDaysAgo = Math.floor(Math.random() * 7);
    const published = new Date(Date.now() - publishedDaysAgo * 24 * 60 * 60 * 1000);
    const score = sentiments[i % sentiments.length];

    out.push({
      id: `mention_${i}`,
      brandId: i < 20 ? "brand_asus" : "brand_sean",
      platform,
      board: boards[i % boards.length],
      author: authors[i % authors.length],
      title: titles[i % titles.length],
      url: urls[i % urls.length] + `?i=${i}`,
      pushCount: Math.floor(Math.random() * 50),
      summary: summaries[i % summaries.length],
      sentimentScore: score,
      publishedAt: published.toISOString(),
      scrapedAt: now(),
    });
  }
  return out;
}

const mentions: Mention[] = makeMockMentions();

// ===== Alerts =====
const alerts: Alert[] = [
  {
    id: "alert_neg",
    brandId: "brand_asus",
    triggerType: "negative_sentiment",
    threshold: -50,
    channels: ["line", "email"],
    isActive: true,
  },
  {
    id: "alert_push",
    brandId: "brand_asus",
    triggerType: "high_push",
    threshold: 30,
    channels: ["line"],
    isActive: true,
  },
];

// ===== Notifications (空,跑才會產生) =====
const notifications: Notification[] = [];

// ===== Outbox (mock notification queue,寫到 outbox/*.json) =====
const outbox: OutboxItem[] = [];

// ===== API =====

export const mockDb = {
  // Users
  getUser: (id: string) => users.find((u) => u.id === id),

  // Brands
  listBrands: (userId: string) => brands.filter((b) => b.userId === userId),
  getBrand: (id: string) => brands.find((b) => b.id === id),

  // Mentions
  listMentions: (opts: {
    brandId?: string;
    platform?: Platform;
    days?: number;
    limit?: number;
  } = {}) => {
    let result = [...mentions];
    if (opts.brandId) result = result.filter((m) => m.brandId === opts.brandId);
    if (opts.platform) result = result.filter((m) => m.platform === opts.platform);
    if (opts.days !== undefined) {
      const cutoff = Date.now() - opts.days * 24 * 60 * 60 * 1000;
      result = result.filter((m) => new Date(m.publishedAt).getTime() >= cutoff);
    }
    result.sort(
      (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
    );
    if (opts.limit) result = result.slice(0, opts.limit);
    return result;
  },
  getMention: (id: string) => mentions.find((m) => m.id === id),
  insertMention: (m: Omit<Mention, "id" | "scrapedAt">) => {
    const newMention: Mention = {
      ...m,
      id: `mention_${mentions.length}_${Date.now()}`,
      scrapedAt: now(),
    };
    mentions.push(newMention);
    return newMention;
  },

  // Alerts
  listAlerts: (brandId: string) => alerts.filter((a) => a.brandId === brandId),
  getAlert: (id: string) => alerts.find((a) => a.id === id),
  insertAlert: (a: Omit<Alert, "id">) => {
    const newAlert: Alert = { ...a, id: `alert_${alerts.length}_${Date.now()}` };
    alerts.push(newAlert);
    return newAlert;
  },

  // Notifications
  listNotifications: (userId: string) =>
    notifications.filter((n) => n.userId === userId),
  insertNotification: (n: Omit<Notification, "id" | "sentAt">) => {
    const newNotif: Notification = {
      ...n,
      id: `notif_${notifications.length}_${Date.now()}`,
      sentAt: now(),
    };
    notifications.push(newNotif);
    return newNotif;
  },

  // Outbox (mock notification delivery queue)
  pushOutbox: (item: Omit<OutboxItem, "id" | "createdAt" | "sentAt" | "status">) => {
    const newItem: OutboxItem = {
      ...item,
      id: `outbox_${outbox.length}_${Date.now()}`,
      createdAt: now(),
      sentAt: null,
      status: "pending",
    };
    outbox.push(newItem);
    return newItem;
  },
  listOutbox: (limit = 50) => outbox.slice(-limit),
};