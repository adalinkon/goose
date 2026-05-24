import type { SessionUpdate } from "@agentclientprotocol/sdk";
import { useChatStore } from "../stores/chatStore";
import { classifyNotification } from "./notificationClassifier";
import { forceSessionFlush, scheduleSessionFlush } from "./flushScheduler";
import { getNotificationMeta } from "./metadata";
import {
  clearSessionRuntimeBuffers,
  consumeDeferredRuntimeReplay,
  consumeLiveBuffer,
  deferRuntimeReplay,
  getLiveBuffer,
  hasProcessedSeq,
  hasProcessedRuntimeEventId,
  markProcessedSeq,
  markProcessedRuntimeEventId,
} from "./sessionBuffers";
import {
  applyRuntimeReplayUpdate,
  applyHistoryReplayUpdate,
  completeStreamingMessage,
  flushLiveBufferToStore,
  reduceLiveUpdateToBuffer,
} from "./sessionEventReducer";
import { hydrateSession } from "./sessionHydrator";
import { trackReplayNotification } from "./replayPerf";
import { trackLiveAgentChunk } from "./streamTracking";
import type {
  RuntimeNotificationMeta,
  RuntimeSessionNotification,
  RuntimeSnapshot,
  SessionRuntimeView,
} from "./types";
import {
  getAcpConnectionGeneration,
  onAcpConnectionReady,
} from "@/shared/api/acpConnection";
import { acpDetachSessionRuntime } from "@/shared/api/acp";

class SessionRuntimeCoordinator {
  private activeSessionId: string | null = null;
  private activeView: string | null = null;
  private loadPromises = new Map<
    string,
    { generation: number; promise: Promise<void> }
  >();
  private sessionAttachedGeneration = new Map<string, number>();

  constructor() {
    onAcpConnectionReady((generation) => {
      void this.attachActiveSessionsToCurrentConnection(generation);
    });
  }

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
    this.sessionAttachedGeneration.delete(sessionId);
    void acpDetachSessionRuntime(sessionId).catch((error: unknown) => {
      console.warn("[runtime] failed to detach session runtime", error);
    });
  }

  setActiveView(activeView: string): void {
    this.activeView = activeView;
    const sessionId = this.activeSessionId;
    if (!sessionId) return;
    useChatStore.getState().setRuntimeView(sessionId, {
      isVisible: this.isSessionVisible(sessionId),
    });
  }

  ensureSessionAttached(sessionId: string): Promise<void> {
    const currentView =
      useChatStore.getState().sessionRuntimeViewById[sessionId];
    const targetGeneration = getAcpConnectionGeneration();
    if (this.isSessionAttachedToGeneration(sessionId, targetGeneration)) {
      this.flushSession(sessionId);
      return Promise.resolve();
    }

    const existing = this.loadPromises.get(sessionId);
    if (existing?.generation === targetGeneration) return existing.promise;

    const lastSeq = currentView?.lastSeq ?? 0;
    const promise = hydrateSession(sessionId, {
      lastSeq,
      shouldApply: () => this.isCurrentGeneration(targetGeneration),
      onRuntimeSnapshot: (snapshot) => {
        if (this.isCurrentGeneration(targetGeneration)) {
          this.applyRuntimeSnapshot(snapshot);
        }
      },
      onHistoryReady: () => {
        if (!this.isCurrentGeneration(targetGeneration)) {
          return;
        }
        this.flushSession(sessionId);
        this.flushDeferredRuntimeReplay(sessionId);
        const runtimeView =
          useChatStore.getState().sessionRuntimeViewById[sessionId];
        useChatStore.getState().setRuntimeView(sessionId, {
          phase: runtimeView?.activeRequestId ? "attached-runtime" : "ready",
        });
        this.sessionAttachedGeneration.set(sessionId, targetGeneration);
      },
      onFailed: () => {
        if (this.isCurrentGeneration(targetGeneration)) {
          clearSessionRuntimeBuffers(sessionId);
        }
      },
    })
      .then(() => undefined)
      .finally(() => {
        if (this.loadPromises.get(sessionId)?.promise === promise) {
          this.loadPromises.delete(sessionId);
        }
      });
    this.loadPromises.set(sessionId, { generation: targetGeneration, promise });
    return promise;
  }

  ensureSessionLoaded(sessionId: string): Promise<void> {
    return this.ensureSessionAttached(sessionId);
  }

  enqueueNotification(notification: RuntimeSessionNotification): void {
    const sessionId = notification.sessionId;
    const meta = getNotificationMeta(notification);
    const classification = classifyNotification(notification);

    if (meta.seq !== undefined) {
      if (hasProcessedSeq(sessionId, meta.seq)) return;
      markProcessedSeq(sessionId, meta.seq);
      const current =
        useChatStore.getState().sessionRuntimeViewById[sessionId]?.lastSeq ?? 0;
      if (meta.seq > current) {
        useChatStore
          .getState()
          .setRuntimeView(sessionId, { lastSeq: meta.seq });
      }
    }

    if (meta.protocolViolation) {
      console.error(`[runtime-replay] ${meta.protocolViolation}`, notification);
      return;
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

    if (classification === "runtime-replay") {
      this.enqueueRuntimeReplay(sessionId, notification, meta);
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

  private enqueueRuntimeReplay(
    sessionId: string,
    notification: RuntimeSessionNotification,
    meta: RuntimeNotificationMeta,
  ): void {
    const eventId = meta.runtimeEvent?.eventId;
    if (eventId) {
      if (hasProcessedRuntimeEventId(sessionId, eventId)) return;
      markProcessedRuntimeEventId(sessionId, eventId);
    }

    const requiresMessageId = new Set([
      "agent_message_chunk",
      "agent_thought_chunk",
      "tool_call",
      "tool_call_update",
    ]).has(notification.update.sessionUpdate);
    if (requiresMessageId && !meta.messageId && !meta.runtimeEvent?.messageId) {
      console.error(
        "[runtime-replay] missing goose.messageId for chat runtime event",
        notification,
      );
      return;
    }

    const phase =
      useChatStore.getState().sessionRuntimeViewById[sessionId]?.phase ??
      "idle";
    const messageId = meta.messageId ?? meta.runtimeEvent?.messageId;
    const hasTarget = messageId
      ? Boolean(
          useChatStore
            .getState()
            .messagesBySession[sessionId]?.some(
              (message) => message.id === messageId,
            ),
        )
      : true;

    if (phase === "hydrating" && requiresMessageId && !hasTarget) {
      deferRuntimeReplay(sessionId, notification, meta);
      return;
    }

    if (!applyRuntimeReplayUpdate(sessionId, notification.update, meta)) {
      console.error("[runtime-replay] rejected runtime event", notification);
    }
  }

  private flushDeferredRuntimeReplay(sessionId: string): void {
    const deferred = consumeDeferredRuntimeReplay(sessionId);
    for (const item of deferred) {
      if (
        !applyRuntimeReplayUpdate(
          sessionId,
          item.notification.update,
          item.meta,
        )
      ) {
        console.error(
          "[runtime-replay] rejected deferred runtime event",
          item.notification,
        );
      }
    }
  }

  private async attachActiveSessionsToCurrentConnection(
    generation: number,
  ): Promise<void> {
    const store = useChatStore.getState();
    const sessions = Object.entries(store.sessionRuntimeViewById)
      .filter(
        ([sessionId, view]) =>
          view.isVisible ||
          sessionId === this.activeSessionId ||
          sessionId === store.activeSessionId,
      )
      .map(([sessionId]) => sessionId);

    for (const sessionId of sessions) {
      if (!this.isCurrentGeneration(generation)) {
        return;
      }
      await this.ensureSessionAttached(sessionId);
    }
  }

  private isSessionAttachedToGeneration(
    sessionId: string,
    generation: number,
  ): boolean {
    const currentView =
      useChatStore.getState().sessionRuntimeViewById[sessionId];
    const attachedGeneration = this.sessionAttachedGeneration.get(sessionId);
    return (
      (currentView?.phase === "ready" ||
        currentView?.phase === "attached-runtime") &&
      attachedGeneration === generation
    );
  }

  private isCurrentGeneration(generation: number): boolean {
    return getAcpConnectionGeneration() === generation;
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
