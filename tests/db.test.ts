import { describe, it, expect, beforeEach } from "vitest";
import { mockDb } from "@/lib/db/mock";
import type { Platform } from "@/types";

describe("Mock DB", () => {
  it("lists brands for user", () => {
    const brands = mockDb.listBrands("user_demo");
    expect(brands.length).toBeGreaterThanOrEqual(2);
    expect(brands[0].name).toBeTruthy();
  });

  it("returns undefined for non-existent brand", () => {
    expect(mockDb.getBrand("non_existent")).toBeUndefined();
  });

  it("lists mentions filtered by brandId", () => {
    const mentions = mockDb.listMentions({ brandId: "brand_asus" });
    expect(mentions.every((m) => m.brandId === "brand_asus")).toBe(true);
  });

  it("lists mentions filtered by platform", () => {
    const mentions = mockDb.listMentions({ platform: "PTT" as Platform });
    expect(mentions.every((m) => m.platform === "PTT")).toBe(true);
  });

  it("lists mentions filtered by days", () => {
    const mentions = mockDb.listMentions({ days: 3 });
    const cutoff = Date.now() - 3 * 24 * 60 * 60 * 1000;
    expect(
      mentions.every((m) => new Date(m.publishedAt).getTime() >= cutoff)
    ).toBe(true);
  });

  it("inserts new mention", () => {
    const before = mockDb.listMentions({}).length;
    mockDb.insertMention({
      brandId: "brand_asus",
      platform: "PTT",
      board: "Test",
      author: "tester",
      title: "Test article",
      url: `https://test.com/${Date.now()}`,
      pushCount: 5,
      summary: "test",
      sentimentScore: 50,
      publishedAt: new Date().toISOString(),
    });
    const after = mockDb.listMentions({}).length;
    expect(after).toBe(before + 1);
  });
});