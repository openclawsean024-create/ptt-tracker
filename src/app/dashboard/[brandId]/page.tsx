import { notFound } from "next/navigation";
import Link from "next/link";
import { mockDb } from "@/lib/db/mock";
import { generateDashboardSummary } from "@/lib/dashboard/summary";

/**
 * Dashboard page — 對應 PRD §3.1 P0-3 + AC-01
 * 跨平台熱度儀表板
 */

const PLATFORM_COLORS: Record<string, string> = {
  PTT: "#1d4ed8",
  DCARD: "#ec4899",
  THREADS: "#8b5cf6",
  BAHAMUT: "#f59e0b",
};

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ brandId: string }>;
}) {
  const { brandId } = await params;
  const brand = mockDb.getBrand(brandId);
  if (!brand) notFound();

  let summary;
  try {
    summary = generateDashboardSummary(brandId, 7);
  } catch (e) {
    return <div style={{ padding: 32 }}>Error: {String(e)}</div>;
  }

  return (
    <main style={{ maxWidth: 1024, margin: "0 auto", padding: "32px 16px" }}>
      <Link
        href="/"
        style={{ color: "#6b7280", fontSize: 14, textDecoration: "none" }}
      >
        ← 返回首頁
      </Link>

      <h1 style={{ fontSize: 28, color: "#1d4ed8", marginTop: 8 }}>
        🛰️ {summary.brandName} 口碑儀表板
      </h1>
      <p style={{ color: "#6b7280", fontSize: 14 }}>
        過去 {summary.periodDays} 天 · {summary.totalMentions} 篇跨平台提及 ·
        平均情緒 {summary.averageSentiment}
      </p>

      {/* 平台佔比 */}
      <section style={{ marginTop: 32 }}>
        <h2 style={{ fontSize: 20 }}>📡 平台佔比</h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
            gap: 12,
            marginTop: 12,
          }}
        >
          {Object.entries(summary.platformBreakdown).map(([p, n]) => (
            <div
              key={p}
              style={{
                padding: 16,
                background: PLATFORM_COLORS[p] ?? "#6b7280",
                color: "white",
                borderRadius: 8,
                textAlign: "center",
              }}
            >
              <div style={{ fontSize: 28, fontWeight: 700 }}>{n}</div>
              <div style={{ fontSize: 13, opacity: 0.9 }}>{p}</div>
            </div>
          ))}
        </div>
      </section>

      {/* 情緒走勢 */}
      <section style={{ marginTop: 32 }}>
        <h2 style={{ fontSize: 20 }}>📈 情緒走勢 (每日平均)</h2>
        {summary.sentimentTrend.length === 0 ? (
          <p style={{ color: "#6b7280" }}>尚無資料</p>
        ) : (
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              gap: 4,
              height: 120,
              padding: 12,
              background: "#f9fafb",
              borderRadius: 8,
              marginTop: 12,
            }}
          >
            {summary.sentimentTrend.map((p) => (
              <div
                key={p.date}
                title={`${p.date}: ${p.score}`}
                style={{
                  flex: 1,
                  height: `${Math.max(8, Math.abs(p.score))}%`,
                  background: p.score >= 0 ? "#10b981" : "#ef4444",
                  borderRadius: 4,
                  minHeight: 8,
                }}
              />
            ))}
          </div>
        )}
      </section>

      {/* TOP 文章 */}
      <section style={{ marginTop: 32 }}>
        <h2 style={{ fontSize: 20 }}>🔥 TOP 10 熱門文章</h2>
        <ol style={{ paddingLeft: 0, listStyle: "none" }}>
          {summary.topMentions.map((m, i) => (
            <li
              key={m.id}
              style={{
                padding: 12,
                border: "1px solid #e5e7eb",
                borderRadius: 8,
                marginBottom: 8,
                background: "#fff",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <strong style={{ minWidth: 24 }}>#{i + 1}</strong>
                <span
                  style={{
                    fontSize: 11,
                    padding: "2px 6px",
                    background: PLATFORM_COLORS[m.platform] ?? "#6b7280",
                    color: "white",
                    borderRadius: 4,
                  }}
                >
                  {m.platform}
                </span>
                <span style={{ fontSize: 12, color: "#6b7280" }}>
                  推爆 {m.pushCount}
                </span>
                {m.sentimentScore !== null && (
                  <span
                    style={{
                      fontSize: 12,
                      padding: "2px 6px",
                      borderRadius: 4,
                      background:
                        m.sentimentScore > 15
                          ? "#d1fae5"
                          : m.sentimentScore < -15
                          ? "#fee2e2"
                          : "#f3f4f6",
                    }}
                  >
                    情緒 {m.sentimentScore}
                  </span>
                )}
              </div>
              <a
                href={m.url}
                target="_blank"
                rel="noreferrer"
                style={{
                  display: "block",
                  marginTop: 6,
                  color: "#1d4ed8",
                  textDecoration: "none",
                  fontWeight: 500,
                }}
              >
                {m.title}
              </a>
              {m.summary && (
                <div style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>
                  {m.summary}
                </div>
              )}
            </li>
          ))}
        </ol>
      </section>

      <section style={{ marginTop: 32 }}>
        <a
          href={`/api/reports/weekly?brandId=${brandId}&format=html`}
          target="_blank"
          rel="noreferrer"
          style={{
            display: "inline-block",
            padding: "12px 20px",
            background: "#1d4ed8",
            color: "white",
            borderRadius: 8,
            textDecoration: "none",
          }}
        >
          📊 開啟完整週報 (新分頁)
        </a>
      </section>
    </main>
  );
}