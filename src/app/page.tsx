import Link from "next/link";
import { mockDb } from "@/lib/db/mock";

/**
 * Home Page — Landing + Brand List
 * 對應 PRD §2.1 使用者流程 [首次進入]
 */

export default function Home() {
  const brands = mockDb.listBrands("user_demo");

  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: "32px 16px" }}>
      <h1 style={{ fontSize: 36, color: "#1d4ed8", margin: 0 }}>
        🛰️ ptt-tracker
      </h1>
      <p style={{ color: "#6b7280", marginTop: 4 }}>
        中文社群雷達 — PTT + Dcard + Threads + 巴哈姆特 跨平台品牌監控
      </p>

      <section
        style={{
          marginTop: 32,
          padding: 24,
          background: "#eff6ff",
          borderRadius: 12,
        }}
      >
        <h2 style={{ margin: 0, color: "#1d4ed8" }}>v3.0 Sweet Spot Rewrite</h2>
        <p style={{ marginTop: 8, lineHeight: 1.6 }}>
          從「PTT 個人監控」(市場 2/10) 升級到「中文社群雷達」(市場 5-9/10)。
          目標族群:中小企業行銷經理。每月 NT$499,免費 7 天 trial。
        </p>
        <p style={{ fontSize: 14, color: "#6b7280" }}>
          本部署為 v3.0 production 第一版,使用 mock 資料展示完整 6 個 P0 功能
          (跨平台 + AI + Dashboard + 警示 + 週報 + 付費)。
        </p>
      </section>

      <section style={{ marginTop: 32 }}>
        <h2>📡 我的監控品牌 ({brands.length})</h2>
        <ul style={{ listStyle: "none", padding: 0 }}>
          {brands.map((b) => (
            <li
              key={b.id}
              style={{
                padding: 16,
                background: "#fff",
                border: "1px solid #e5e7eb",
                borderRadius: 8,
                marginBottom: 8,
              }}
            >
              <Link
                href={`/dashboard/${b.id}`}
                style={{
                  fontSize: 18,
                  color: "#1d4ed8",
                  textDecoration: "none",
                  fontWeight: 600,
                }}
              >
                {b.name}
              </Link>
              <div style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>
                關鍵字:{b.keywords.join(", ")}
              </div>
              {b.competitors.length > 0 && (
                <div style={{ fontSize: 13, color: "#6b7280" }}>
                  競品:{b.competitors.join(", ")}
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section
        style={{
          marginTop: 32,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: 12,
        }}
      >
        <Link
          href="/pricing"
          style={{
            padding: 16,
            background: "#1d4ed8",
            color: "white",
            borderRadius: 8,
            textDecoration: "none",
            textAlign: "center",
          }}
        >
          💳 查看方案
        </Link>
        <Link
          href="/api/reports/weekly?brandId=brand_asus&format=html"
          style={{
            padding: 16,
            background: "#10b981",
            color: "white",
            borderRadius: 8,
            textDecoration: "none",
            textAlign: "center",
          }}
        >
          📊 週報範例
        </Link>
        <a
          href="/PRD/SPEC.md"
          style={{
            padding: 16,
            background: "#6b7280",
            color: "white",
            borderRadius: 8,
            textDecoration: "none",
            textAlign: "center",
          }}
        >
          📋 完整規格
        </a>
      </section>

      <footer
        style={{
          marginTop: 48,
          padding: 16,
          fontSize: 12,
          color: "#9ca3af",
          textAlign: "center",
          borderTop: "1px solid #e5e7eb",
        }}
      >
        ptt-tracker v3.0 · Hermes Agent OpenClaw · Notion:
        <code> 329449ca-65d8-8190-b4d8-f7c30f25d5bf</code>
      </footer>
    </main>
  );
}