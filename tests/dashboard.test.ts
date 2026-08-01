import { describe, it, expect } from "vitest";
import { generateDashboardSummary } from "@/lib/dashboard/summary";

describe("Dashboard Summary", () => {
  it("generates summary for valid brand", () => {
    const summary = generateDashboardSummary("brand_asus", 7);
    expect(summary.brandId).toBe("brand_asus");
    expect(summary.brandName).toBe("ASUS");
    expect(summary.totalMentions).toBeGreaterThanOrEqual(0);
    expect(summary.platformBreakdown).toHaveProperty("PTT");
    expect(summary.platformBreakdown).toHaveProperty("DCARD");
    expect(summary.platformBreakdown).toHaveProperty("THREADS");
    expect(summary.platformBreakdown).toHaveProperty("BAHAMUT");
  });

  it("throws for non-existent brand", () => {
    expect(() => generateDashboardSummary("not_exist", 7)).toThrow();
  });

  it("respects periodDays", () => {
    const s7 = generateDashboardSummary("brand_asus", 7);
    const s3 = generateDashboardSummary("brand_asus", 3);
    expect(s7.periodDays).toBe(7);
    expect(s3.periodDays).toBe(3);
    // s7 should have ≥ mentions than s3 (or equal)
    expect(s7.totalMentions).toBeGreaterThanOrEqual(s3.totalMentions);
  });
});