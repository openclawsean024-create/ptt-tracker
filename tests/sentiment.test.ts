import { describe, it, expect } from "vitest";
import { analyzeSentimentHeuristic, summarize } from "@/lib/sentiment/analyzer";

describe("Sentiment Analyzer (Heuristic)", () => {
  it("positive text gets positive score", () => {
    const result = analyzeSentimentHeuristic("這個產品超棒好用,推薦大家購買");
    expect(result.score).toBeGreaterThan(0);
    expect(result.label).toBe("positive");
  });

  it("negative text gets negative score", () => {
    const result = analyzeSentimentHeuristic("踩雷,客服態度差,後悔買這個爛東西");
    expect(result.score).toBeLessThan(0);
    expect(result.label).toBe("negative");
  });

  it("neutral text gets ~0 score", () => {
    const result = analyzeSentimentHeuristic("今天天氣晴朗,我出去散步");
    expect(result.score).toBe(0);
    expect(result.label).toBe("neutral");
  });

  it("score is bounded [-100, 100]", () => {
    const result = analyzeSentimentHeuristic("讚讚讚讚讚讚讚讚讚讚讚讚讚讚讚讚讚");
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.score).toBeGreaterThanOrEqual(-100);
  });

  it("confidence increases with keyword matches", () => {
    const few = analyzeSentimentHeuristic("好棒");
    const many = analyzeSentimentHeuristic("好棒 推薦 滿意 值得 完美 強 CP值高");
    expect(many.confidence).toBeGreaterThan(few.confidence);
  });
});

describe("Summarize", () => {
  it("truncates long text", () => {
    const long = "a".repeat(100);
    expect(summarize(long, 60)).toHaveLength(61); // 60 chars + ellipsis
  });

  it("keeps short text", () => {
    expect(summarize("hello", 60)).toBe("hello");
  });
});