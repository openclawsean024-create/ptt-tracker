import { describe, it, expect } from "vitest";
import { createCheckoutSession, getPricing } from "@/lib/stripe/checkout";

describe("Stripe Checkout (Mock)", () => {
  it("creates session for valid plan", () => {
    const session = createCheckoutSession("PRO_MONTHLY");
    expect(session.id).toMatch(/^cs_mock_/);
    expect(session.url).toMatch(/^https:\/\/checkout\.stripe\.com/);
    expect(session.amount).toBe(49900);
    expect(session.currency).toBe("TWD");
    expect(session.status).toBe("open");
  });

  it("returns pricing structure", () => {
    const pricing = getPricing();
    expect(pricing.PRO_MONTHLY.amount).toBe(49900);
    expect(pricing.PRO_YEARLY.amount).toBe(499000);
    expect(pricing.ENTERPRISE.amount).toBe(300000);
  });
});