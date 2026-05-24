import { beforeEach, describe, expect, it } from "vitest";
import type { SessionNotification } from "@agentclientprotocol/sdk";
import { useChatStore } from "@/features/chat/stores/chatStore";
import { useChatSessionStore } from "@/features/chat/stores/chatSessionStore";
import { clearReplayBuffer } from "@/features/chat/hooks/replayBuffer";
import {
  clearMessageTracking,
  handleExtNotification,
  handleSessionNotification,
} from "./acpNotificationHandler";

describe("acpNotificationHandler", () => {
  beforeEach(() => {
    clearMessageTracking();
    clearReplayBuffer("acp-session-1");
    clearReplayBuffer("acp-session-2");
    useChatStore.setState({
      messagesBySession: {},
      sessionStateById: {},
      queuedMessageBySession: {},
      draftsBySession: {},
      activeSessionId: null,
      isConnected: false,
      loadingSessionIds: new Set<string>(),
      scrollTargetMessageBySession: {},
    });
    useChatSessionStore.setState({
      sessions: [],
      sessionRuntimeById: {},
      activeSessionId: null,
      isLoading: false,
      hasHydratedSessions: false,
      contextPanelOpenBySession: {},
      activeWorkspaceBySession: {},
    });
  });

  it("applies usage updates to the ACP session id", async () => {
    const notification = {
      sessionId: "acp-session-1",
      update: {
        sessionUpdate: "usage_update",
        used: 512,
        size: 8192,
      },
    } as SessionNotification;

    await handleSessionNotification(notification);

    const runtime = useChatStore.getState().getSessionRuntime("acp-session-1");
    expect(runtime.tokenState.accumulatedTotal).toBe(512);
    expect(runtime.tokenState.contextLimit).toBe(8192);
    expect(runtime.hasUsageSnapshot).toBe(true);
  });

  it("applies session index activity updates by revision", async () => {
    await handleExtNotification("_goose/session_index/event", {
      sessionIndex: {
        event: "activity",
        revision: 5,
        session_id: "acp-session-1",
        runtime: { status: "running" },
        updated_at: "2026-05-24T00:00:00.000Z",
      },
    });
    await handleExtNotification("_goose/session_index/event", {
      event: "activity",
      revision: 4,
      sessionId: "acp-session-1",
      runtime: { status: "idle" },
      updatedAt: "2026-05-24T00:01:00.000Z",
    });

    expect(
      useChatSessionStore.getState().sessionRuntimeById["acp-session-1"],
    ).toEqual({
      status: "running",
      revision: 5,
      updatedAt: "2026-05-24T00:00:00.000Z",
    });
  });

  it("applies session index added updates", async () => {
    await handleExtNotification("_goose/session_index/event", {
      event: "added",
      revision: 2,
      session: {
        sessionId: "acp-session-2",
        runtime: { status: "wait" },
        updatedAt: "2026-05-24T00:02:00.000Z",
      },
    });

    expect(
      useChatSessionStore.getState().sessionRuntimeById["acp-session-2"],
    ).toMatchObject({
      status: "wait",
      revision: 2,
      updatedAt: "2026-05-24T00:02:00.000Z",
    });
  });
});
