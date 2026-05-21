import type { ChatRuntimeEvent, SessionLiveBuffer } from "./types";

const liveBuffers = new Map<string, SessionLiveBuffer>();
const processedSeqBySession = new Map<string, Set<number>>();

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
}

export function clearSessionRuntimeBuffers(sessionId: string): void {
  clearLiveBuffer(sessionId);
  processedSeqBySession.delete(sessionId);
}
