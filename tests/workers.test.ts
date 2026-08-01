import { describe, it, expect } from "vitest";
import { runAllWorkers } from "@/workers/aggregator";

describe("Aggregator", () => {
  it("runs all 4 platform workers in parallel", async () => {
    const result = await runAllWorkers("brand_asus");
    expect(result).toHaveProperty("ptt");
    expect(result).toHaveProperty("dcard");
    expect(result).toHaveProperty("threads");
    expect(result).toHaveProperty("bahamut");
    expect(result.brandId).toBe("brand_asus");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("totalInserted is sum of all platform inserts", async () => {
    const result = await runAllWorkers("brand_asus");
    const sum =
      result.ptt.inserted +
      result.dcard.inserted +
      result.threads.inserted +
      result.bahamut.inserted;
    expect(result.totalInserted).toBe(sum);
  });
});