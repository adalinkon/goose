import type { SessionNotification } from "@agentclientprotocol/sdk";
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

const handler: AcpNotificationHandler = {
  handleSessionNotification,
};

export default handler;
