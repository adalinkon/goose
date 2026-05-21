import type { LoadSessionResponse } from "@agentclientprotocol/sdk";
import { useChatStore } from "../stores/chatStore";
import { useChatSessionStore } from "../stores/chatSessionStore";
import { useProjectStore } from "@/features/projects/stores/projectStore";
import { resolveSessionCwd } from "@/features/projects/lib/sessionCwdSelection";
import { acpLoadSession } from "@/shared/api/acp";
import {
  clearReplayBuffer,
  getAndDeleteReplayBuffer,
} from "../hooks/replayBuffer";
import { clearReplayPerf, getReplayPerf } from "./replayPerf";
import { perfLog } from "@/shared/lib/perfLog";
import { getLoadSessionRuntimeSnapshot } from "./metadata";
import type { RuntimeSnapshot } from "./types";

async function resolveWorkingDir(
  sessionId: string,
): Promise<string | undefined> {
  const session = useChatSessionStore.getState().getSession(sessionId);
  const project = session?.projectId
    ? (useProjectStore
        .getState()
        .projects.find((candidate) => candidate.id === session.projectId) ??
      null)
    : null;
  return resolveSessionCwd(project);
}

export async function hydrateSession(
  sessionId: string,
  options?: {
    lastSeq?: number;
    onRuntimeSnapshot?: (snapshot: RuntimeSnapshot) => void;
    onHistoryReady?: () => void;
    onFailed?: () => void;
  },
): Promise<LoadSessionResponse | null> {
  const sid = sessionId.slice(0, 8);
  const t0 = performance.now();
  perfLog(`[perf:load] ${sid} start`);

  const store = useChatStore.getState();
  store.setSessionLoading(sessionId, true);
  store.setRuntimeView(sessionId, { phase: "hydrating" });
  clearReplayBuffer(sessionId);

  try {
    const workingDir = await resolveWorkingDir(sessionId);
    const response = await acpLoadSession(sessionId, workingDir, {
      lastSeq: options?.lastSeq,
    });

    const snapshot = getLoadSessionRuntimeSnapshot(response);
    if (snapshot) {
      options?.onRuntimeSnapshot?.(snapshot);
    }

    const buffer = getAndDeleteReplayBuffer(sessionId);
    const replayStats = getReplayPerf(sessionId);
    clearReplayPerf(sessionId);
    if (buffer && buffer.length > 0) {
      useChatStore.getState().setMessages(sessionId, buffer);
    }

    store.setSessionLoading(sessionId, false);
    options?.onHistoryReady?.();

    const t2 = performance.now();
    perfLog(
      `[perf:load] ${sid} replay: notifs=${replayStats?.count ?? 0} span=${replayStats?.spanMs.toFixed(1) ?? "0"}ms msgs=${buffer?.length ?? 0} total=${(t2 - t0).toFixed(1)}ms`,
    );
    return response;
  } catch (err) {
    console.error("Failed to load session messages:", err);
    clearReplayBuffer(sessionId);
    useChatStore.getState().setSessionLoading(sessionId, false);
    useChatStore.getState().setRuntimeView(sessionId, { phase: "failed" });
    options?.onFailed?.();
    return null;
  }
}
