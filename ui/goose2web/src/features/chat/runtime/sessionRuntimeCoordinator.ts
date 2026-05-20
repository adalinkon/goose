import type { SessionUpdate } from "@agentclientprotocol/sdk";
import { useChatStore } from "../stores/chatStore";
import { classifyNotification } from "./notificationClassifier";
import { forceSessionFlush, scheduleSessionFlush } from "./flushScheduler";
import { getNotificationMeta } from "./metadata";
import {
  clearSessionRuntimeBuffers,
  consumeLiveBuffer,
  getLiveBuffer,
  hasProcessedSeq,
  markProcessedSeq,
} from "./sessionBuffers";
import {
  applyHistoryReplayUpdate,
  completeStreamingMessage,
  flushLiveBufferToStore,
  reduceLiveUpdateToBuffer,
} from "./sessionEventReducer";
import { hydrateSession } from "./sessionHydrator";
import { trackReplayNotification } from "./replayPerf";
import { trackLiveAgentChunk } from "./streamTracking";
import type {
  RuntimeSessionNotification,
  RuntimeSnapshot,
  SessionRuntimeView,
} from "./types";

class SessionRuntimeCoordinator {
  private activeSessionId: string | null = null;
  private activeView: string | null = null;
  private loadPromises = new Map<string, Promise<void>>();

  activateSession(sessionId: string, options?: { activeView?: string }): void {
    if (this.activeSessionId && this.activeSessionId !== sessionId) {
      this.deactivateSession(this.activeSessionId);
    }
    this.activeSessionId = sessionId;
    this.activeView = options?.activeView ?? "chat";
    useChatStore.getState().setRuntimeView(sessionId, {
      isVisible: true,
      hasUnread: false,
    });
    useChatStore.getState().markSessionRead(sessionId);
    this.flushSession(sessionId);
  }

  deactivateSession(sessionId: string): void {
    useChatStore.getState().setRuntimeView(sessionId, { isVisible: false });
    if (this.activeSessionId === sessionId) {
      this.activeSessionId = null;
    }
  }

  setActiveView(activeView: string): void {
    this.activeView = activeView;
    const sessionId = this.activeSessionId;
    if (!sessionId) return;
    useChatStore.getState().setRuntimeView(sessionId, {
      isVisible: this.isSessionVisible(sessionId),
    });
  }

  ensureSessionLoaded(sessionId: string): Promise<void> {
    const currentView =
      useChatStore.getState().sessionRuntimeViewById[sessionId];
    if (
      currentView?.phase === "ready" ||
      currentView?.phase === "attached-runtime"
    ) {
      this.flushSession(sessionId);
      return Promise.resolve();
    }

    const existing = this.loadPromises.get(sessionId);
    if (existing) return existing;

    const lastSeq = currentView?.lastSeq ?? 0;
    const promise = hydrateSession(sessionId, {
      lastSeq,
      onRuntimeSnapshot: (snapshot) => this.applyRuntimeSnapshot(snapshot),
      onHistoryReady: () => {
        this.flushSession(sessionId);
        const runtimeView =
          useChatStore.getState().sessionRuntimeViewById[sessionId];
        useChatStore.getState().setRuntimeView(sessionId, {
          phase: runtimeView?.activeRequestId ? "attached-runtime" : "ready",
        });
      },
      onFailed: () => clearSessionRuntimeBuffers(sessionId),
    }).then(() => {
      this.loadPromises.delete(sessionId);
    });
    this.loadPromises.set(sessionId, promise);
    return promise;
  }

  enqueueNotification(notification: RuntimeSessionNotification): void {
    const sessionId = notification.sessionId;
    const meta = getNotificationMeta(notification);
    const classification = classifyNotification(notification);

    if (meta.seq !== undefined) {
      if (hasProcessedSeq(sessionId, meta.seq)) return;
      markProcessedSeq(sessionId, meta.seq);
    }

    if (classification === "runtime-snapshot" && meta.runtime) {
      const phase =
        useChatStore.getState().sessionRuntimeViewById[sessionId]?.phase ??
        "idle";
      this.applyRuntimeSnapshot(meta.runtime);
      if (!meta.runtime.activeRequestId) {
        if (phase === "hydrating") {
          return;
        }
        forceSessionFlush(sessionId, (id) => this.flushSession(id));
        completeStreamingMessage(sessionId);
      }
      return;
    }

    if (classification === "history-replay") {
      this.trackReplayPerf(sessionId);
      applyHistoryReplayUpdate(sessionId, notification.update);
      return;
    }

    this.enqueueLiveUpdate(sessionId, notification.update);
  }

  flushSession(sessionId: string): void {
    if (!this.isSessionVisible(sessionId)) {
      return;
    }
    const buffer = consumeLiveBuffer(sessionId);
    if (!buffer) return;
    flushLiveBufferToStore(sessionId, buffer);
  }

  flushAll(): void {
    const sessionIds = Object.keys(
      useChatStore.getState().sessionRuntimeViewById,
    );
    for (const sessionId of sessionIds) {
      this.flushSession(sessionId);
    }
  }

  private enqueueLiveUpdate(sessionId: string, update: SessionUpdate): void {
    if (update.sessionUpdate === "agent_message_chunk") {
      trackLiveAgentChunk(sessionId);
    }

    const buffer = getLiveBuffer(sessionId);
    reduceLiveUpdateToBuffer(sessionId, update, buffer);

    const store = useChatStore.getState();
    const current = store.sessionRuntimeViewById[sessionId];
    store.setRuntimeView(sessionId, {
      isVisible: this.isSessionVisible(sessionId),
      hasUnread: this.isSessionVisible(sessionId)
        ? false
        : (current?.hasUnread ?? true),
    });

    if (current?.phase === "hydrating") {
      return;
    }

    if (this.shouldFlushSynchronously()) {
      forceSessionFlush(sessionId, (id) => this.flushSession(id));
    } else if (this.isSessionVisible(sessionId)) {
      scheduleSessionFlush(sessionId, (id) => this.flushSession(id));
    } else {
      store.markSessionUnread(sessionId);
    }
  }

  private applyRuntimeSnapshot(snapshot: RuntimeSnapshot): void {
    const sessionId = snapshot.sessionId;
    const isResponding = Boolean(snapshot.activeRequestId);
    const patch: Partial<SessionRuntimeView> = {
      activeRequestId: snapshot.activeRequestId,
      lastSeq: snapshot.lastSeq,
      isResponding,
      isVisible: this.isSessionVisible(sessionId),
    };
    useChatStore.getState().setRuntimeView(sessionId, patch);
    useChatStore
      .getState()
      .setChatState(sessionId, isResponding ? "streaming" : "idle");
  }

  private isSessionVisible(sessionId: string): boolean {
    const storeActiveSessionId = useChatStore.getState().activeSessionId;
    if (this.activeView === "chat" && this.activeSessionId === sessionId) {
      return true;
    }
    if (storeActiveSessionId === sessionId) {
      return true;
    }
    return this.activeSessionId === null && storeActiveSessionId === null;
  }

  private shouldFlushSynchronously(): boolean {
    return (
      this.activeSessionId === null &&
      useChatStore.getState().activeSessionId === null
    );
  }

  private trackReplayPerf(sessionId: string): void {
    trackReplayNotification(sessionId);
  }
}

export const sessionRuntimeCoordinator = new SessionRuntimeCoordinator();
