const FLUSH_INTERVAL_MS = 40;

const timers = new Map<string, number>();

export function scheduleSessionFlush(
  sessionId: string,
  flush: (sessionId: string) => void,
): void {
  if (timers.has(sessionId)) return;

  const timer = window.setTimeout(() => {
    timers.delete(sessionId);
    flush(sessionId);
  }, FLUSH_INTERVAL_MS);
  timers.set(sessionId, timer);
}

export function cancelScheduledFlush(sessionId: string): void {
  const timer = timers.get(sessionId);
  if (timer === undefined) return;
  window.clearTimeout(timer);
  timers.delete(sessionId);
}

export function forceSessionFlush(
  sessionId: string,
  flush: (sessionId: string) => void,
): void {
  cancelScheduledFlush(sessionId);
  flush(sessionId);
}
