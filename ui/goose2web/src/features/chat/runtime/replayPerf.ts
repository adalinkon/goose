import { perfLog } from "@/shared/lib/perfLog";

interface ReplayPerf {
  firstAt: number;
  lastAt: number;
  count: number;
}

const replayPerf = new Map<string, ReplayPerf>();

export function trackReplayNotification(sessionId: string): void {
  const sid = sessionId.slice(0, 8);
  let perf = replayPerf.get(sessionId);
  const now = performance.now();
  if (!perf) {
    perf = { firstAt: now, lastAt: now, count: 0 };
    replayPerf.set(sessionId, perf);
    perfLog(`[perf:replay] ${sid} first notification received`);
  }
  perf.lastAt = now;
  perf.count += 1;
}

export function getReplayPerf(
  sessionId: string,
): { count: number; spanMs: number } | null {
  const perf = replayPerf.get(sessionId);
  if (!perf) return null;
  return { count: perf.count, spanMs: perf.lastAt - perf.firstAt };
}

export function clearReplayPerf(sessionId: string): void {
  replayPerf.delete(sessionId);
}
