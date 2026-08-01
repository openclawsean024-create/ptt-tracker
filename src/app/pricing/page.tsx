import Link from "next/link";
import { getPricing } from "@/lib/stripe/checkout";

/**
 * Pricing Page — 對應 PRD §9 變現路徑 + 定價心理學
 */

export default function PricingPage() {
  const pricing = getPricing();

  return (
    <main style={{ maxWidth: 1024, margin: "0 auto", padding: "32px 16px" }}>
      <Link href="/" style={{ color: "#6b7280", fontSize: 14, textDecoration: "none" }}>
        ← 返回首頁
      </Link>

      <h1 style={{ fontSize: 28, color: "#1d4ed8", marginTop: 8 }}>💳 方案定價</h1>
      <p style={{ color: "#6b7280" }}>
        中小企業行銷團隊的甜蜜點。免費 7 天 trial,不綁卡。
      </p>

      <div
        style={{
          marginTop: 24,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 16,
        }}
      >
        <PricingCard
          name="Free"
          price="NT$0"
          period="永久"
          features={[
            "1 個監控品牌",
            "7 天歷史資料",
            "基本 dashboard",
          ]}
          highlight={false}
          cta="免費註冊"
          plan="FREE"
        />
        <PricingCard
          name="Pro Monthly"
          price="NT$499"
          period="月"
          features={[
            "3 個監控品牌",
            "90 天歷史",
            "LINE 即時警示",
            "週報 PDF",
            "AI 情緒分析",
          ]}
          highlight={true}
          cta="升級 Pro"
          plan="PRO_MONTHLY"
        />
        <PricingCard
          name="Pro Yearly"
          price="NT$4,990"
          period="年 (省 17%)"
          features={["Pro Monthly 全部", "年付折扣"]}
          highlight={false}
          cta="年付方案"
          plan="PRO_YEARLY"
        />
        <PricingCard
          name="Enterprise"
          price="NT$3,000"
          period="月"
          features={[
            "20 個品牌 + 多用戶",
            "公關公司適用",
            "客製化 alert",
            "API access",
          ]}
          highlight={false}
          cta="聯絡業務"
          plan="ENTERPRISE"
        />
      </div>

      <section style={{ marginTop: 32, padding: 16, background: "#fef3c7", borderRadius: 8 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>💡 定價心理學小抄</h2>
        <ul style={{ marginTop: 8, paddingLeft: 20, fontSize: 14 }}>
          <li>NT$499 而非 NT$500 — 中小企業預算甜蜜點 (&lt; NT$500 衝動消費)</li>
          <li>年付折 17% — 鎖定高 LTV (NT$4,990 vs NT$5,988)</li>
          <li>Enterprise NT$3,000 — 低於 OpView NT$3 萬的 1/10</li>
          <li>7 天免費試用 — 降低首次付費摩擦</li>
        </ul>
      </section>
    </main>
  );
}

function PricingCard({
  name,
  price,
  period,
  features,
  highlight,
  cta,
  plan,
}: {
  name: string;
  price: string;
  period: string;
  features: string[];
  highlight: boolean;
  cta: string;
  plan: string;
}) {
  return (
    <div
      style={{
        padding: 20,
        border: highlight ? "2px solid #1d4ed8" : "1px solid #e5e7eb",
        borderRadius: 12,
        background: highlight ? "#eff6ff" : "#fff",
      }}
    >
      <h3 style={{ margin: 0, fontSize: 18 }}>{name}</h3>
      <div style={{ fontSize: 28, fontWeight: 700, color: "#1d4ed8", marginTop: 8 }}>
        {price}
      </div>
      <div style={{ fontSize: 13, color: "#6b7280" }}>{period}</div>
      <ul style={{ paddingLeft: 16, fontSize: 14, marginTop: 12 }}>
        {features.map((f) => (
          <li key={f} style={{ margin: "4px 0" }}>
            ✓ {f}
          </li>
        ))}
      </ul>
      <button
        disabled={plan === "FREE"}
        style={{
          marginTop: 12,
          width: "100%",
          padding: "10px 16px",
          background: highlight ? "#1d4ed8" : "#6b7280",
          color: "white",
          border: "none",
          borderRadius: 8,
          cursor: plan === "FREE" ? "not-allowed" : "pointer",
          opacity: plan === "FREE" ? 0.5 : 1,
        }}
      >
        {cta}
      </button>
      <p style={{ fontSize: 11, color: "#9ca3af", marginTop: 8, textAlign: "center" }}>
        {plan !== "FREE" && "(v3 mock checkout)"}
      </p>
    </div>
  );
}