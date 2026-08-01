/**
 * Stripe Mock — 對應 PRD §3.1 P0-6 (Stripe Checkout + Webhook)
 *
 * 生產模式:用真實 Stripe SDK。
 * Mock 模式:回傳假 session URL,讓 UI 流程可展示。
 */

export interface StripeCheckoutSession {
  id: string;
  url: string;
  amount: number;
  currency: string;
  plan: "PRO_MONTHLY" | "PRO_YEARLY" | "ENTERPRISE";
  status: "open" | "complete" | "expired";
}

const PRICING = {
  PRO_MONTHLY: { amount: 49900, currency: "TWD", period: "月" }, // NT$499 = 49900 分
  PRO_YEARLY: { amount: 499000, currency: "TWD", period: "年" }, // NT$4,990
  ENTERPRISE: { amount: 300000, currency: "TWD", period: "月" }, // NT$3,000
} as const;

export function createCheckoutSession(
  plan: keyof typeof PRICING
): StripeCheckoutSession {
  const apiKey = process.env.STRIPE_SECRET_KEY;
  const pricing = PRICING[plan];

  if (apiKey && apiKey.startsWith("sk_")) {
    // 生產模式:真的呼叫 Stripe API
    // 為 v3 MVP 簡化,實際 deploy 時需要 fetch("https://api.stripe.com/v1/checkout/sessions", ...)
    // 這裡先 mock
  }

  // Mock 模式
  return {
    id: `cs_mock_${Math.random().toString(36).slice(2, 14)}`,
    url: `https://checkout.stripe.com/c/pay/cs_mock_${Date.now()}`,
    amount: pricing.amount,
    currency: pricing.currency,
    plan,
    status: "open",
  };
}

export function getPricing() {
  return PRICING;
}