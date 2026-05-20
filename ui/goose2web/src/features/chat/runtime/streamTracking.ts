import { clearReplayAssistantTracking } from "@/shared/api/acpReplayAssistant";
import { perfLog } from "@/shared/lib/perfLog";

const presetMessageIds = new Map<string, string>();

interface LivePerf {
  sendStartedAt: number;
  firstChunkAt: number | null;
  chunkCount: number;
}

const livePerf = new Map<string, LivePerf>();

export function setActiveMessageId(sessionId: string, messageId: string): void {
  presetMessageIds.set(sessionId, messageId);
  livePerf.set(sessionId, {
    sendStartedAt: performance.now(),
    firstChunkAt: null,
    chunkCount: 0,
  });
}

export function getPresetMessageId(sessionId: string): string | undefined {
  return presetMessageIds.get(sessionId);
}

export function trackLiveAgentChunk(sessionId: string): void {
  const perf = livePerf.get(sessionId);
  if (!perf) return;

  perf.chunkCount += 1;
  if (perf.firstChunkAt !== null) return;

  perf.firstChunkAt = performance.now();
  const sid = sessionId.slice(0, 8);
  perfLog(
    `[perf:stream] ${sid} first agent_message_chunk at ttft=${(perf.firstChunkAt - perf.sendStartedAt).toFixed(1)}ms`,
  );
}

export function clearActiveMessageId(sessionId: string): void {
  presetMessageIds.delete(sessionId);
  const perf = livePerf.get(sessionId);
  if (!perf) return;

  const sid = sessionId.slice(0, 8);
  const total = performance.now() - perf.sendStartedAt;
  const ttft =
    perf.firstChunkAt !== null
      ? (perf.firstChunkAt - perf.sendStartedAt).toFixed(1)
      : "n/a";
  perfLog(
    `[perf:stream] ${sid} stream ended — ttft=${ttft}ms total=${total.toFixed(1)}ms chunks=${perf.chunkCount}`,
  );
  livePerf.delete(sessionId);
}

export function clearMessageTracking(): void {
  presetMessageIds.clear();
  clearReplayAssistantTracking();
}
