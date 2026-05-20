import type { RuntimeNotificationMeta, RuntimeSnapshot } from "./types";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberFromMeta(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
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

  return {
    seq: numberFromMeta(merged.seq),
    kind: typeof merged.kind === "string" ? merged.kind : undefined,
    delivery: typeof merged.delivery === "string" ? merged.delivery : undefined,
    runtime: parseRuntimeSnapshot(merged.runtime),
  };
}

export function getLoadSessionRuntimeSnapshot(response: {
  _meta?: unknown;
}): RuntimeSnapshot | undefined {
  const meta = isRecord(response._meta) ? response._meta : {};
  return parseRuntimeSnapshot(meta.runtime);
}
