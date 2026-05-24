import { useChatStore } from "../stores/chatStore";
import { getNotificationMeta } from "./metadata";
import type { NotificationClass, RuntimeSessionNotification } from "./types";

export function classifyNotification(
  notification: RuntimeSessionNotification,
): NotificationClass {
  const meta = getNotificationMeta(notification);
  const store = useChatStore.getState();
  const phase =
    store.sessionRuntimeViewById[notification.sessionId]?.phase ?? "idle";

  if (meta.runtime) {
    return "runtime-snapshot";
  }

  if (meta.delivery === "replay") {
    return "runtime-replay";
  }

  if (meta.seq !== undefined || meta.kind || meta.delivery) {
    return phase === "hydrating" ? "runtime-replay" : "live";
  }

  if (
    phase === "hydrating" ||
    store.loadingSessionIds.has(notification.sessionId)
  ) {
    return "history-replay";
  }

  return "live";
}
