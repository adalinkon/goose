import type {
  ChatRuntimeEvent,
  RuntimeNotificationMeta,
  RuntimeSessionNotification,
  SessionLiveBuffer,
} from "./types";

const liveBuffers = new Map<string, SessionLiveBuffer>();
const processedSeqBySession = new Map<string, Set<number>>();
const processedRuntimeEventIdsBySession = new Map<string, Set<string>>();
const deferredRuntimeReplayBySession = new Map<
  string,
  Array<{
    notification: RuntimeSessionNotification;
    meta: RuntimeNotificationMeta;
  }>
>();
const MAX_PROCESSED_SEQ = 2048;

export function getLiveBuffer(sessionId: string): SessionLiveBuffer {
  let buffer = liveBuffers.get(sessionId);
  if (!buffer) {
    buffer = {
      messageId: null,
      pendingText: "",
      pendingEvents: [],
      dirty: false,
    };
    liveBuffers.set(sessionId, buffer);
  }
  return buffer;
}

export function enqueueLiveEvent(event: ChatRuntimeEvent): void {
  const buffer = getLiveBuffer(event.sessionId);
  if (event.type === "agentText") {
    buffer.messageId = event.messageId ?? buffer.messageId;
    buffer.pendingText += event.text;
  } else {
    buffer.pendingEvents.push(event);
  }
  buffer.dirty = true;
}

export function consumeLiveBuffer(sessionId: string): SessionLiveBuffer | null {
  const buffer = liveBuffers.get(sessionId);
  if (!buffer?.dirty) return null;

  const consumed: SessionLiveBuffer = {
    messageId: buffer.messageId,
    pendingText: buffer.pendingText,
    pendingEvents: buffer.pendingEvents,
    dirty: true,
  };
  liveBuffers.set(sessionId, {
    messageId: buffer.messageId,
    pendingText: "",
    pendingEvents: [],
    dirty: false,
  });
  return consumed;
}

export function clearLiveBuffer(sessionId: string): void {
  liveBuffers.delete(sessionId);
}

export function deferRuntimeReplay(
  sessionId: string,
  notification: RuntimeSessionNotification,
  meta: RuntimeNotificationMeta,
): void {
  const deferred = deferredRuntimeReplayBySession.get(sessionId) ?? [];
  deferred.push({ notification, meta });
  deferredRuntimeReplayBySession.set(sessionId, deferred);
}

export function consumeDeferredRuntimeReplay(sessionId: string) {
  const deferred = deferredRuntimeReplayBySession.get(sessionId) ?? [];
  deferredRuntimeReplayBySession.delete(sessionId);
  return deferred;
}

export function clearDeferredRuntimeReplay(sessionId: string): void {
  deferredRuntimeReplayBySession.delete(sessionId);
}

export function hasProcessedSeq(sessionId: string, seq?: number): boolean {
  if (seq === undefined) return false;
  return processedSeqBySession.get(sessionId)?.has(seq) ?? false;
}

export function markProcessedSeq(sessionId: string, seq?: number): void {
  if (seq === undefined) return;
  let processed = processedSeqBySession.get(sessionId);
  if (!processed) {
    processed = new Set<number>();
    processedSeqBySession.set(sessionId, processed);
  }
  processed.add(seq);
  if (processed.size > MAX_PROCESSED_SEQ) {
    const sorted = [...processed].sort((a, b) => a - b);
    for (const stale of sorted.slice(0, sorted.length - MAX_PROCESSED_SEQ)) {
      processed.delete(stale);
    }
  }
}

export function hasProcessedRuntimeEventId(
  sessionId: string,
  eventId?: string,
): boolean {
  if (!eventId) return false;
  return processedRuntimeEventIdsBySession.get(sessionId)?.has(eventId) ?? false;
}

export function markProcessedRuntimeEventId(
  sessionId: string,
  eventId?: string,
): void {
  if (!eventId) return;
  let processed = processedRuntimeEventIdsBySession.get(sessionId);
  if (!processed) {
    processed = new Set<string>();
    processedRuntimeEventIdsBySession.set(sessionId, processed);
  }
  processed.add(eventId);
}

export function clearSessionRuntimeBuffers(sessionId: string): void {
  clearLiveBuffer(sessionId);
  processedSeqBySession.delete(sessionId);
  processedRuntimeEventIdsBySession.delete(sessionId);
  clearDeferredRuntimeReplay(sessionId);
}
