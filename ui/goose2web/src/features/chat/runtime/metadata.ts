import type { RuntimeNotificationMeta, RuntimeSnapshot } from "./types";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberFromMeta(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function stringFromMeta(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function normalizeEpochMilliseconds(value: number): number | undefined {
  if (!Number.isFinite(value) || value < 0) return undefined;
  return value < 1_000_000_000_000 ? value * 1000 : value;
}

function parseRuntimeSnapshot(value: unknown): RuntimeSnapshot | undefined {
  if (!isRecord(value)) return undefined;

  const sessionId = value.sessionId;
  const activeRequestId = value.activeRequestId;
  const lastSeq = value.lastSeq;

  if (typeof sessionId !== "string") return undefined;

  return {
    sessionId,
    activeRequestId:
      typeof activeRequestId === "string" ? activeRequestId : null,
    lastSeq: numberFromMeta(lastSeq) ?? 0,
  };
}

function parseRuntimeEvent(value: unknown): RuntimeNotificationMeta["runtimeEvent"] | undefined {
  if (!isRecord(value)) return undefined;

  const protocolVersion = numberFromMeta(value.protocolVersion);
  const eventId = stringFromMeta(value.eventId);
  const seq = numberFromMeta(value.seq);
  const kind = stringFromMeta(value.kind);
  const delivery = stringFromMeta(value.delivery);

  if (
    protocolVersion !== 1 ||
    !eventId ||
    seq === undefined ||
    !kind ||
    (delivery !== "replay" && delivery !== "snapshot")
  ) {
    return undefined;
  }

  return {
    protocolVersion,
    eventId,
    seq,
    kind,
    delivery,
    requestId: stringFromMeta(value.requestId),
    messageId: stringFromMeta(value.messageId),
    toolCallId: stringFromMeta(value.toolCallId),
  };
}

export function getNotificationMeta(notification: {
  _meta?: unknown;
  update?: unknown;
}): RuntimeNotificationMeta {
  const meta = isRecord(notification._meta) ? notification._meta : {};
  const updateMeta =
    isRecord(notification.update) && isRecord(notification.update._meta)
      ? notification.update._meta
      : {};
  const merged = { ...updateMeta, ...meta };
  const gooseFromUpdate = isRecord(updateMeta.goose) ? updateMeta.goose : {};
  const gooseFromNotification = isRecord(meta.goose) ? meta.goose : {};
  const goose = { ...gooseFromUpdate, ...gooseFromNotification };
  const runtimeEvent = parseRuntimeEvent(goose.runtime);
  const runtimeProtocolVersion = isRecord(goose.runtime)
    ? numberFromMeta(goose.runtime.protocolVersion)
    : undefined;

  return {
    seq: numberFromMeta(merged.seq),
    kind: stringFromMeta(merged.kind),
    delivery: stringFromMeta(merged.delivery),
    requestId: stringFromMeta(merged.requestId) ?? stringFromMeta(goose.requestId),
    messageId: stringFromMeta(goose.messageId),
    created:
      typeof goose.created === "number"
        ? normalizeEpochMilliseconds(goose.created)
        : undefined,
    runtimeEvent,
    protocolViolation:
      runtimeProtocolVersion !== undefined && runtimeProtocolVersion !== 1
        ? `Unsupported runtime protocol version ${runtimeProtocolVersion}`
        : undefined,
    replayTooOld: merged.replayTooOld === true,
    runtime: parseRuntimeSnapshot(merged.runtime),
  };
}

export function getLoadSessionRuntimeSnapshot(response: {
  _meta?: unknown;
}): RuntimeSnapshot | undefined {
  const meta = isRecord(response._meta) ? response._meta : {};
  return parseRuntimeSnapshot(meta.runtime);
}
