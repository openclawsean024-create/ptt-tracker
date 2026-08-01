/**
 * Aggregator — 統一呼叫 4 個 platform worker
 * 對應 PRD §3.1 P0-1 (每 5 分鐘掃描 4 平台)
 */

import { runPttWorker } from "@/workers/ptt/worker";
import { runDcardWorker } from "@/workers/dcard/worker";
import { runThreadsWorker } from "@/workers/threads/worker";
import { runBahamutWorker } from "@/workers/bahamut/worker";

export interface AggregateResult {
  brandId: string;
  ptt: { scanned: number; inserted: number; alertsTriggered: number };
  dcard: { scanned: number; inserted: number; alertsTriggered: number };
  threads: { scanned: number; inserted: number; alertsTriggered: number };
  bahamut: { scanned: number; inserted: number; alertsTriggered: number };
  totalScanned: number;
  totalInserted: number;
  totalAlerts: number;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
}

export async function runAllWorkers(brandId: string): Promise<AggregateResult> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();

  const [ptt, dcard, threads, bahamut] = await Promise.all([
    runPttWorker(brandId),
    runDcardWorker(brandId),
    runThreadsWorker(brandId),
    runBahamutWorker(brandId),
  ]);

  const finishedAt = new Date().toISOString();

  return {
    brandId,
    ptt,
    dcard,
    threads,
    bahamut,
    totalScanned: ptt.scanned + dcard.scanned + threads.scanned + bahamut.scanned,
    totalInserted: ptt.inserted + dcard.inserted + threads.inserted + bahamut.inserted,
    totalAlerts:
      ptt.alertsTriggered + dcard.alertsTriggered + threads.alertsTriggered + bahamut.alertsTriggered,
    startedAt,
    finishedAt,
    durationMs: Date.now() - t0,
  };
}