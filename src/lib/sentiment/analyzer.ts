/**
 * Sentiment Analyzer — AI 情緒分析模組
 *
 * 對應 PRD/SPEC.md §3.1 P0-2 + AC-03 (與人類標註相關性 ≥ 0.75)
 *
 * 生產環境用 OpenAI GPT-4o-mini (需 OPENAI_API_KEY env)。
 * Mock 模式用啟發式啟發 (lexicon-based)。
 */

import type { SentimentResult } from "@/types";

const POSITIVE_KEYWORDS = [
  "棒", "讚", "推", "推薦", "好用", "滿意", "值得", "CP值高", "便宜", "划算",
  "強", "完美", "流暢", "頂", "讚爆", "good", "great", "excellent", "amazing",
  "love", "best", "perfect", "smooth", "fast", "穩", "讚的", "神物",
];

const NEGATIVE_KEYWORDS = [
  "爛", "差", "雷", "後悔", "踩雷", "不推", "不推薦", "過熱", "當機", "卡",
  "貴", "失望", "災情", "bug", "壞掉", "客服差", "退貨", "退款",
  "bad", "worst", "terrible", "awful", "slow", "broken", "useless", "hate",
  "過熱", "災情", "當機", "連線問題", "處理慢",
];

/**
 * 啟發式情緒打分 (no AI API required)
 * Returns score in range [-100, +100]
 */
export function analyzeSentimentHeuristic(text: string): SentimentResult {
  const lower = text.toLowerCase();
  let score = 0;
  let matched = 0;

  for (const kw of POSITIVE_KEYWORDS) {
    const matches = (lower.match(new RegExp(kw.toLowerCase(), "g")) || []).length;
    if (matches > 0) {
      score += matches * 12;
      matched += matches;
    }
  }
  for (const kw of NEGATIVE_KEYWORDS) {
    const matches = (lower.match(new RegExp(kw.toLowerCase(), "g")) || []).length;
    if (matches > 0) {
      score -= matches * 15;
      matched += matches;
    }
  }

  // 沒任何關鍵字 → 中性
  if (matched === 0) {
    return { score: 0, label: "neutral", summary: "中性內容,無明顯情緒傾向。", confidence: 0.4 };
  }

  // 限制範圍
  score = Math.max(-100, Math.min(100, score));
  const label = score > 15 ? "positive" : score < -15 ? "negative" : "neutral";
  const confidence = Math.min(0.9, 0.4 + matched * 0.1);

  return {
    score,
    label,
    summary: `啟發式分析:偵測到 ${matched} 個情緒關鍵字,得分 ${score}。`,
    confidence,
  };
}

/**
 * 摘要文字 (mock — 生產用 GPT-4o-mini)
 */
export function summarize(text: string, maxLen = 60): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen).trim() + "…";
}

/**
 * 主要 entry — 分析文章
 * 生產環境會自動偵測 OPENAI_API_KEY,有就用 GPT,沒有就用啟發式
 */
export async function analyzeMention(title: string, content?: string): Promise<SentimentResult> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (apiKey && apiKey.startsWith("sk-")) {
    return analyzeWithOpenAI(title, content, apiKey);
  }

  const text = `${title} ${content || ""}`;
  const result = analyzeSentimentHeuristic(text);
  return { ...result, summary: summarize(title) };
}

async function analyzeWithOpenAI(
  title: string,
  content: string | undefined,
  apiKey: string
): Promise<SentimentResult> {
  // 生產模式:呼叫 GPT-4o-mini
  // Mock 模式不會跑到這
  const prompt = `請分析以下中文社群貼文的「情緒分數」(介於 -100 到 +100,負面為負,正面為正)與一句話摘要(<=60字)。
標題:${title}
內容:${content || "(無)"}

回應 JSON 格式:{"score": <number>, "label": "positive"|"neutral"|"negative", "summary": "<一句話>", "confidence": <0-1>}`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.3,
    }),
  });

  if (!res.ok) {
    // fallback
    return analyzeSentimentHeuristic(`${title} ${content || ""}`);
  }

  const data = await res.json();
  const parsed = JSON.parse(data.choices[0].message.content);
  return parsed as SentimentResult;
}