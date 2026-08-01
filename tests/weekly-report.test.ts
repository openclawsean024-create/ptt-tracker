import { describe, it, expect } from "vitest";
import { generateWeeklyReport } from "@/lib/pdf/weekly-report";

describe("Weekly Report", () => {
  it("generates report with summary + HTML", () => {
    const report = generateWeeklyReport("brand_asus");
    expect(report.brandId).toBe("brand_asus");
    expect(report.htmlContent).toContain("<!DOCTYPE html>");
    expect(report.htmlContent).toContain("ASUS");
    expect(report.weekStart).toBeTruthy();
    expect(report.weekEnd).toBeTruthy();
    expect(report.summary.totalMentions).toBeGreaterThanOrEqual(0);
  });

  it("throws for non-existent brand", () => {
    expect(() => generateWeeklyReport("not_exist")).toThrow();
  });
});