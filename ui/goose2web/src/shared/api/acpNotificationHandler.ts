import type { SessionNotification } from "@agentclientprotocol/sdk";
import type { SessionIndexStatus } from "@/shared/types/chat";
import { useChatSessionStore } from "@/features/chat/stores/chatSessionStore";
import { sessionRuntimeCoordinator } from "@/features/chat/runtime/sessionRuntimeCoordinator";
import {
  clearActiveMessageId,
  clearMessageTracking,
  setActiveMessageId,
} from "@/features/chat/runtime/streamTracking";
import {
  clearReplayPerf,
  getReplayPerf,
} from "@/features/chat/runtime/replayPerf";
import type { AcpNotificationHandler } from "./acpConnection";

export { setActiveMessageId, clearActiveMessageId, clearMessageTracking };
export { getReplayPerf, clearReplayPerf };

export async function handleSessionNotification(
  notification: SessionNotification,
): Promise<void> {
  sessionRuntimeCoordinator.enqueueNotification(notification);
}

export async function handleExtNotification(
  method: string,
  params: Record<string, unknown>,
): Promise<void> {
  if (method !== "_goose/session_index/event") {
    return;
  }

  const event = parseSessionIndexEvent(params);
  if (!event) {
    return;
  }

  useChatSessionStore
    .getState()
    .applySessionRuntime(
      event.sessionId,
      event.status,
      event.revision,
      event.updatedAt,
    );
}

const handler: AcpNotificationHandler = {
  handleSessionNotification,
  handleExtNotification,
};

export default handler;

function parseSessionIndexEvent(value: Record<string, unknown>):
  | {
      sessionId: string;
      status: SessionIndexStatus;
      revision: number;
      updatedAt?: string;
    }
  | undefined {
  const eventValue = isRecord(value.sessionIndex) ? value.sessionIndex : value;
  const event = eventValue.event;
  if (event === "activity") {
    const sessionId = stringField(eventValue, "sessionId", "session_id");
    const revision = eventValue.revision;
    const status = parseSessionIndexStatus(eventValue.runtime);
    if (
      !sessionId ||
      typeof revision !== "number" ||
      !Number.isFinite(revision) ||
      !status
    ) {
      return undefined;
    }
    return {
      sessionId,
      status,
      revision,
      updatedAt: stringField(eventValue, "updatedAt", "updated_at"),
    };
  }

  if (event === "added" || event === "updated") {
    const revision = eventValue.revision;
    const session = eventValue.session;
    if (
      typeof revision !== "number" ||
      !Number.isFinite(revision) ||
      !isRecord(session)
    ) {
      return undefined;
    }
    const sessionId = stringField(session, "sessionId", "session_id");
    const status = parseSessionIndexStatus(session.runtime);
    if (!sessionId || !status) {
      return undefined;
    }
    return {
      sessionId,
      status,
      revision,
      updatedAt: stringField(session, "updatedAt", "updated_at"),
    };
  }

  return undefined;
}

function parseSessionIndexStatus(
  value: unknown,
): SessionIndexStatus | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const status = value.status;
  if (
    status === "idle" ||
    status === "running" ||
    status === "wait" ||
    status === "dead"
  ) {
    return status;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(
  value: Record<string, unknown>,
  camelKey: string,
  snakeKey: string,
): string | undefined {
  const camelValue = value[camelKey];
  if (typeof camelValue === "string") {
    return camelValue;
  }
  const snakeValue = value[snakeKey];
  return typeof snakeValue === "string" ? snakeValue : undefined;
}
