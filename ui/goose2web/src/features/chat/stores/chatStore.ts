import { create } from "zustand";
import type {
  ChatAttachmentDraft,
  Message,
  MessageContent,
  ToolRequestContent,
  ToolResponseContent,
} from "@/shared/types/messages";
import { clearReplayBuffer } from "../hooks/replayBuffer";
import type {
  ChatState,
  SessionChatRuntime,
  TokenState,
} from "@/shared/types/chat";
import {
  INITIAL_SESSION_CHAT_RUNTIME,
  INITIAL_TOKEN_STATE,
} from "@/shared/types/chat";
import type { SessionRuntimeView } from "../runtime/types";
import { INITIAL_SESSION_RUNTIME_VIEW } from "../runtime/types";
import {
  appendContentToIndex,
  appendMessageToIndex,
  clearSessionMessageIndex,
  getSessionMessageIndex,
  rebuildSessionMessageIndex,
  removeMessageFromIndex,
} from "../runtime/sessionIndexes";
import { clearSessionRuntimeBuffers } from "../runtime/sessionBuffers";
import type { ChatSendOptions, ChatSkillDraft } from "../types";
import { loadCachedDrafts, persistDrafts } from "./draftPersistence";

function createInitialSessionRuntime(): SessionChatRuntime {
  return {
    ...INITIAL_SESSION_CHAT_RUNTIME,
    tokenState: { ...INITIAL_TOKEN_STATE },
  };
}

export interface QueuedMessage {
  text: string;
  personaId?: string;
  attachments?: ChatAttachmentDraft[];
  sendOptions?: ChatSendOptions;
}

export interface ScrollTargetMessage {
  messageId: string;
  query?: string;
}

interface ChatStoreState {
  messagesBySession: Record<string, Message[]>;
  sessionStateById: Record<string, SessionChatRuntime>;
  sessionRuntimeViewById: Record<string, SessionRuntimeView>;
  sessionMessageCountById: Record<string, number>;
  startedSessionIds: Set<string>;
  queuedMessageBySession: Record<string, QueuedMessage>;
  draftsBySession: Record<string, string>;
  skillDraftsBySession: Record<string, ChatSkillDraft[]>;
  activeSessionId: string | null;
  isConnected: boolean;
  loadingSessionIds: Set<string>;
  scrollTargetMessageBySession: Record<string, ScrollTargetMessage | null>;
}

interface ChatStoreActions {
  setActiveSession: (sessionId: string) => void;
  addMessage: (sessionId: string, message: Message) => void;
  appendMessage: (sessionId: string, message: Message) => void;
  updateMessage: (
    sessionId: string,
    messageId: string,
    updater: (msg: Message) => Message,
  ) => void;
  removeMessage: (sessionId: string, messageId: string) => void;
  setMessages: (sessionId: string, messages: Message[]) => void;
  clearMessages: (sessionId: string) => void;
  getActiveMessages: () => Message[];
  getSessionRuntime: (sessionId: string) => SessionChatRuntime;
  setStreamingMessageId: (sessionId: string, id: string | null) => void;
  setPendingAssistantProvider: (
    sessionId: string,
    providerId: string | null,
  ) => void;
  appendToStreamingMessage: (
    sessionId: string,
    content: MessageContent,
  ) => void;
  appendContentByMessageId: (
    sessionId: string,
    messageId: string,
    content: MessageContent,
  ) => void;
  appendTextByMessageId: (
    sessionId: string,
    messageId: string,
    text: string,
  ) => void;
  appendToolRequest: (
    sessionId: string,
    messageId: string,
    toolRequest: ToolRequestContent,
  ) => void;
  patchToolRequest: (
    sessionId: string,
    toolCallId: string,
    patch: Partial<ToolRequestContent>,
  ) => void;
  appendToolResponse: (
    sessionId: string,
    toolCallId: string,
    response: ToolResponseContent,
  ) => void;
  updateStreamingText: (sessionId: string, text: string) => void;
  setChatState: (sessionId: string, state: ChatState) => void;
  setRuntimeView: (
    sessionId: string,
    runtimeView: Partial<SessionRuntimeView>,
  ) => void;
  setError: (sessionId: string, error: string | null) => void;
  setConnected: (connected: boolean) => void;
  markSessionRead: (sessionId: string) => void;
  markSessionUnread: (sessionId: string) => void;
  updateTokenState: (sessionId: string, state: Partial<TokenState>) => void;
  replaceTokenState: (
    sessionId: string,
    tokenState: TokenState,
    hasUsageSnapshot?: boolean,
  ) => void;
  resetTokenState: (sessionId: string) => void;
  enqueueMessage: (sessionId: string, message: QueuedMessage) => void;
  dismissQueuedMessage: (sessionId: string) => void;
  setDraft: (sessionId: string, text: string) => void;
  clearDraft: (sessionId: string) => void;
  setSkillDrafts: (sessionId: string, skills: ChatSkillDraft[]) => void;
  clearSkillDrafts: (sessionId: string) => void;
  setSessionLoading: (sessionId: string, loading: boolean) => void;
  setScrollTargetMessage: (
    sessionId: string,
    messageId: string,
    query?: string,
  ) => void;
  clearScrollTargetMessage: (sessionId: string) => void;
  cleanupSession: (sessionId: string) => void;
}

export type ChatStore = ChatStoreState & ChatStoreActions;

export const useChatStore = create<ChatStore>((set, get) => ({
  // State
  messagesBySession: {},
  sessionStateById: {},
  sessionRuntimeViewById: {},
  sessionMessageCountById: {},
  startedSessionIds: new Set<string>(),
  queuedMessageBySession: {},
  draftsBySession: loadCachedDrafts(),
  skillDraftsBySession: {},
  activeSessionId: null,
  isConnected: false,
  loadingSessionIds: new Set<string>(),
  scrollTargetMessageBySession: {},

  // Session management
  setActiveSession: (sessionId) =>
    set((state) => ({
      activeSessionId: sessionId,
      sessionStateById: state.sessionStateById[sessionId]
        ? state.sessionStateById
        : {
            ...state.sessionStateById,
            [sessionId]: createInitialSessionRuntime(),
          },
    })),

  // Message management
  addMessage: (sessionId, message) => get().appendMessage(sessionId, message),

  appendMessage: (sessionId, message) =>
    set((state) => {
      const messages = [...(state.messagesBySession[sessionId] ?? []), message];
      appendMessageToIndex(sessionId, message, messages.length - 1);
      const startedSessionIds = new Set(state.startedSessionIds);
      startedSessionIds.add(sessionId);
      return {
        messagesBySession: {
          ...state.messagesBySession,
          [sessionId]: messages,
        },
        sessionMessageCountById: {
          ...state.sessionMessageCountById,
          [sessionId]: messages.length,
        },
        startedSessionIds,
      };
    }),

  updateMessage: (sessionId, messageId, updater) =>
    set((state) => {
      const messages = state.messagesBySession[sessionId];
      if (!messages) return state;
      const nextMessages = messages.map((m) =>
        m.id === messageId ? updater(m) : m,
      );
      rebuildSessionMessageIndex(sessionId, nextMessages);
      return {
        messagesBySession: {
          ...state.messagesBySession,
          [sessionId]: nextMessages,
        },
      };
    }),

  removeMessage: (sessionId, messageId) =>
    set((state) => {
      const messages = state.messagesBySession[sessionId];
      if (!messages) return state;
      const nextMessages = messages.filter((m) => m.id !== messageId);
      removeMessageFromIndex(sessionId, messageId);
      rebuildSessionMessageIndex(sessionId, nextMessages);
      return {
        messagesBySession: {
          ...state.messagesBySession,
          [sessionId]: nextMessages,
        },
        sessionMessageCountById: {
          ...state.sessionMessageCountById,
          [sessionId]: nextMessages.length,
        },
      };
    }),

  setMessages: (sessionId, messages) =>
    set((state) => {
      rebuildSessionMessageIndex(sessionId, messages);
      const startedSessionIds = new Set(state.startedSessionIds);
      if (messages.length > 0) {
        startedSessionIds.add(sessionId);
      } else {
        startedSessionIds.delete(sessionId);
      }
      return {
        messagesBySession: {
          ...state.messagesBySession,
          [sessionId]: messages,
        },
        sessionMessageCountById: {
          ...state.sessionMessageCountById,
          [sessionId]: messages.length,
        },
        startedSessionIds,
      };
    }),

  clearMessages: (sessionId) =>
    set((state) => {
      clearSessionMessageIndex(sessionId);
      const startedSessionIds = new Set(state.startedSessionIds);
      startedSessionIds.delete(sessionId);
      return {
        messagesBySession: {
          ...state.messagesBySession,
          [sessionId]: [],
        },
        sessionMessageCountById: {
          ...state.sessionMessageCountById,
          [sessionId]: 0,
        },
        startedSessionIds,
        sessionStateById: {
          ...state.sessionStateById,
          [sessionId]: createInitialSessionRuntime(),
        },
      };
    }),

  // Active session helpers
  getActiveMessages: () => {
    const { activeSessionId, messagesBySession } = get();
    if (!activeSessionId) return [];
    const messages = messagesBySession[activeSessionId] ?? [];
    return messages.filter((m) => m.metadata?.userVisible);
  },

  getSessionRuntime: (sessionId) =>
    get().sessionStateById[sessionId] ?? createInitialSessionRuntime(),

  // Streaming
  setStreamingMessageId: (sessionId, id) =>
    set((state) => ({
      sessionStateById: {
        ...state.sessionStateById,
        [sessionId]: {
          ...(state.sessionStateById[sessionId] ??
            createInitialSessionRuntime()),
          streamingMessageId: id,
        },
      },
    })),

  setPendingAssistantProvider: (sessionId, pendingAssistantProviderId) =>
    set((state) => ({
      sessionStateById: {
        ...state.sessionStateById,
        [sessionId]: {
          ...(state.sessionStateById[sessionId] ??
            createInitialSessionRuntime()),
          pendingAssistantProviderId,
        },
      },
    })),

  appendToStreamingMessage: (sessionId, content) =>
    set((state) => {
      const streamingMessageId =
        state.sessionStateById[sessionId]?.streamingMessageId ?? null;
      if (!streamingMessageId) return state;
      const messages = state.messagesBySession[sessionId];
      if (!messages) return state;
      const index = getSessionMessageIndex(sessionId);
      const messageIndex = index.messageIdToIndex.get(streamingMessageId);
      if (messageIndex === undefined) return state;
      const target = messages[messageIndex];
      if (!target) return state;
      const nextContent = [...target.content, content];
      const nextMessages = [...messages];
      nextMessages[messageIndex] = { ...target, content: nextContent };
      appendContentToIndex(
        sessionId,
        streamingMessageId,
        messageIndex,
        content,
        nextContent.length - 1,
      );
      return {
        messagesBySession: {
          ...state.messagesBySession,
          [sessionId]: nextMessages,
        },
      };
    }),

  appendContentByMessageId: (sessionId, messageId, content) =>
    set((state) => {
      const messages = state.messagesBySession[sessionId];
      if (!messages) return state;
      const index = getSessionMessageIndex(sessionId);
      const messageIndex = index.messageIdToIndex.get(messageId);
      if (messageIndex === undefined) return state;
      const message = messages[messageIndex];
      if (!message) return state;
      const nextContent = [...message.content, content];
      const nextMessages = [...messages];
      nextMessages[messageIndex] = { ...message, content: nextContent };
      appendContentToIndex(
        sessionId,
        messageId,
        messageIndex,
        content,
        nextContent.length - 1,
      );
      return {
        messagesBySession: {
          ...state.messagesBySession,
          [sessionId]: nextMessages,
        },
      };
    }),

  appendTextByMessageId: (sessionId, messageId, text) =>
    set((state) => {
      const messages = state.messagesBySession[sessionId];
      if (!messages || !text) return state;
      const messageIndex =
        getSessionMessageIndex(sessionId).messageIdToIndex.get(messageId);
      if (messageIndex === undefined) {
        rebuildSessionMessageIndex(sessionId, messages);
        const rebuiltIndex =
          getSessionMessageIndex(sessionId).messageIdToIndex.get(messageId);
        if (rebuiltIndex === undefined) return state;
        const message = messages[rebuiltIndex];
        if (!message) return state;
        const lastContent = message.content[message.content.length - 1];
        const nextContent =
          lastContent?.type === "text"
            ? [
                ...message.content.slice(0, -1),
                { type: "text" as const, text: lastContent.text + text },
              ]
            : [...message.content, { type: "text" as const, text }];
        const nextMessages = [...messages];
        nextMessages[rebuiltIndex] = { ...message, content: nextContent };
        return {
          messagesBySession: {
            ...state.messagesBySession,
            [sessionId]: nextMessages,
          },
        };
      }
      const message = messages[messageIndex];
      if (!message) return state;
      const lastContent = message.content[message.content.length - 1];
      const nextContent =
        lastContent?.type === "text"
          ? [
              ...message.content.slice(0, -1),
              { type: "text" as const, text: lastContent.text + text },
            ]
          : [...message.content, { type: "text" as const, text }];
      const nextMessages = [...messages];
      nextMessages[messageIndex] = { ...message, content: nextContent };
      return {
        messagesBySession: {
          ...state.messagesBySession,
          [sessionId]: nextMessages,
        },
      };
    }),

  appendToolRequest: (sessionId, messageId, toolRequest) =>
    get().appendContentByMessageId(sessionId, messageId, toolRequest),

  patchToolRequest: (sessionId, toolCallId, patch) =>
    set((state) => {
      const messages = state.messagesBySession[sessionId];
      const location =
        getSessionMessageIndex(sessionId).toolCallIdToLocation.get(toolCallId);
      if (!messages || !location) return state;
      const message = messages[location.messageIndex];
      const content = message?.content[location.contentIndex];
      if (!message || content?.type !== "toolRequest") return state;
      const nextContent = [...message.content];
      nextContent[location.contentIndex] = { ...content, ...patch };
      const nextMessages = [...messages];
      nextMessages[location.messageIndex] = {
        ...message,
        content: nextContent,
      };
      return {
        messagesBySession: {
          ...state.messagesBySession,
          [sessionId]: nextMessages,
        },
      };
    }),

  appendToolResponse: (sessionId, toolCallId, response) =>
    set((state) => {
      const messages = state.messagesBySession[sessionId];
      const location =
        getSessionMessageIndex(sessionId).toolCallIdToLocation.get(toolCallId);
      if (!messages || !location) return state;
      const message = messages[location.messageIndex];
      if (!message) return state;
      const nextMessages = [...messages];
      nextMessages[location.messageIndex] = {
        ...message,
        content: [...message.content, response],
      };
      return {
        messagesBySession: {
          ...state.messagesBySession,
          [sessionId]: nextMessages,
        },
      };
    }),

  updateStreamingText: (sessionId, text) =>
    set((state) => {
      const streamingMessageId =
        state.sessionStateById[sessionId]?.streamingMessageId ?? null;
      if (!streamingMessageId) return state;
      const messages = state.messagesBySession[sessionId];
      if (!messages) return state;
      const messageIndex =
        getSessionMessageIndex(sessionId).messageIdToIndex.get(
          streamingMessageId,
        );
      if (messageIndex === undefined) return state;
      const message = messages[messageIndex];
      if (!message) return state;
      const lastContent = message.content[message.content.length - 1];
      const nextContent =
        lastContent?.type !== "text"
          ? [...message.content, { type: "text" as const, text }]
          : [
              ...message.content.slice(0, -1),
              { type: "text" as const, text: lastContent.text + text },
            ];
      const nextMessages = [...messages];
      nextMessages[messageIndex] = { ...message, content: nextContent };
      return {
        messagesBySession: {
          ...state.messagesBySession,
          [sessionId]: nextMessages,
        },
      };
    }),

  // State
  setChatState: (sessionId, chatState) =>
    set((state) => ({
      sessionStateById: {
        ...state.sessionStateById,
        [sessionId]: {
          ...(state.sessionStateById[sessionId] ??
            createInitialSessionRuntime()),
          chatState,
        },
      },
    })),

  setRuntimeView: (sessionId, runtimeView) =>
    set((state) => {
      const current =
        state.sessionRuntimeViewById[sessionId] ?? INITIAL_SESSION_RUNTIME_VIEW;
      return {
        sessionRuntimeViewById: {
          ...state.sessionRuntimeViewById,
          [sessionId]: {
            ...current,
            ...runtimeView,
          },
        },
      };
    }),

  setError: (sessionId, error) =>
    set((state) => {
      const current =
        state.sessionStateById[sessionId] ?? createInitialSessionRuntime();
      return {
        sessionStateById: {
          ...state.sessionStateById,
          [sessionId]: {
            ...current,
            error,
            chatState: error ? ("error" as const) : current.chatState,
          },
        },
      };
    }),

  setConnected: (isConnected) => set({ isConnected }),

  markSessionRead: (sessionId) =>
    set((state) => {
      const current =
        state.sessionStateById[sessionId] ?? createInitialSessionRuntime();
      if (!current.hasUnread) {
        return state;
      }
      return {
        sessionStateById: {
          ...state.sessionStateById,
          [sessionId]: {
            ...current,
            hasUnread: false,
          },
        },
      };
    }),

  markSessionUnread: (sessionId) =>
    set((state) => {
      const current =
        state.sessionStateById[sessionId] ?? createInitialSessionRuntime();
      if (current.hasUnread) {
        return state;
      }
      return {
        sessionStateById: {
          ...state.sessionStateById,
          [sessionId]: {
            ...current,
            hasUnread: true,
          },
        },
      };
    }),

  // Token tracking
  updateTokenState: (sessionId, partial) =>
    set((state) => {
      const current =
        state.sessionStateById[sessionId]?.tokenState ?? INITIAL_TOKEN_STATE;
      const inputTokens = partial.inputTokens ?? current.inputTokens;
      const outputTokens = partial.outputTokens ?? current.outputTokens;
      const accumulatedInput =
        partial.accumulatedInput ??
        current.accumulatedInput + (partial.inputTokens ?? 0);
      const accumulatedOutput =
        partial.accumulatedOutput ??
        current.accumulatedOutput + (partial.outputTokens ?? 0);
      const accumulatedTotal =
        partial.accumulatedTotal ?? accumulatedInput + accumulatedOutput;
      return {
        sessionStateById: {
          ...state.sessionStateById,
          [sessionId]: {
            ...(state.sessionStateById[sessionId] ??
              createInitialSessionRuntime()),
            tokenState: {
              inputTokens,
              outputTokens,
              totalTokens: inputTokens + outputTokens,
              accumulatedInput,
              accumulatedOutput,
              accumulatedTotal,
              contextLimit: partial.contextLimit ?? current.contextLimit,
            },
            hasUsageSnapshot: true,
          },
        },
      };
    }),

  replaceTokenState: (sessionId, tokenState, hasUsageSnapshot = true) =>
    set((state) => ({
      sessionStateById: {
        ...state.sessionStateById,
        [sessionId]: {
          ...(state.sessionStateById[sessionId] ??
            createInitialSessionRuntime()),
          tokenState: { ...tokenState },
          hasUsageSnapshot,
        },
      },
    })),

  resetTokenState: (sessionId) =>
    set((state) => ({
      sessionStateById: {
        ...state.sessionStateById,
        [sessionId]: {
          ...(state.sessionStateById[sessionId] ??
            createInitialSessionRuntime()),
          tokenState: { ...INITIAL_TOKEN_STATE },
          hasUsageSnapshot: false,
        },
      },
    })),

  // Message queue
  enqueueMessage: (sessionId, message) =>
    set((state) => ({
      queuedMessageBySession: {
        ...state.queuedMessageBySession,
        [sessionId]: message,
      },
    })),

  dismissQueuedMessage: (sessionId) =>
    set((state) => {
      const { [sessionId]: _, ...rest } = state.queuedMessageBySession;
      return { queuedMessageBySession: rest };
    }),

  // Drafts
  setDraft: (sessionId, text) => {
    set((state) => ({
      draftsBySession: { ...state.draftsBySession, [sessionId]: text },
    }));
    persistDrafts(get().draftsBySession);
  },

  clearDraft: (sessionId) => {
    set((state) => {
      const { [sessionId]: _, ...rest } = state.draftsBySession;
      return { draftsBySession: rest };
    });
    persistDrafts(get().draftsBySession);
  },

  setSkillDrafts: (sessionId, skills) =>
    set((state) => {
      if (skills.length === 0) {
        const { [sessionId]: _, ...rest } = state.skillDraftsBySession;
        return { skillDraftsBySession: rest };
      }

      return {
        skillDraftsBySession: {
          ...state.skillDraftsBySession,
          [sessionId]: skills,
        },
      };
    }),

  clearSkillDrafts: (sessionId) =>
    set((state) => {
      const { [sessionId]: _, ...rest } = state.skillDraftsBySession;
      return { skillDraftsBySession: rest };
    }),

  // Session loading (replay)
  setSessionLoading: (sessionId, loading) =>
    set((state) => {
      const next = new Set(state.loadingSessionIds);
      if (loading) {
        next.add(sessionId);
      } else {
        next.delete(sessionId);
      }
      return { loadingSessionIds: next };
    }),

  setScrollTargetMessage: (sessionId, messageId, query) =>
    set((state) => ({
      scrollTargetMessageBySession: {
        ...state.scrollTargetMessageBySession,
        [sessionId]: { messageId, query },
      },
    })),

  clearScrollTargetMessage: (sessionId) =>
    set((state) => {
      if (!state.scrollTargetMessageBySession[sessionId]) {
        return state;
      }

      const nextTargets = { ...state.scrollTargetMessageBySession };
      delete nextTargets[sessionId];

      return {
        scrollTargetMessageBySession: nextTargets,
      };
    }),

  // Cleanup
  cleanupSession: (sessionId) => {
    // Discard any orphaned replay buffer so module-level Map doesn't leak.
    clearReplayBuffer(sessionId);
    clearSessionMessageIndex(sessionId);
    clearSessionRuntimeBuffers(sessionId);
    set((state) => {
      const { [sessionId]: _, ...rest } = state.messagesBySession;
      const { [sessionId]: __, ...remainingSessionState } =
        state.sessionStateById;
      const { [sessionId]: removedRuntimeView, ...remainingRuntimeViews } =
        state.sessionRuntimeViewById;
      void removedRuntimeView;
      const { [sessionId]: removedCount, ...remainingMessageCounts } =
        state.sessionMessageCountById;
      void removedCount;
      const { [sessionId]: ___, ...remainingQueued } =
        state.queuedMessageBySession;
      const { [sessionId]: ____, ...remainingDrafts } = state.draftsBySession;
      const { [sessionId]: removedSkillDrafts, ...remainingSkillDrafts } =
        state.skillDraftsBySession;
      void removedSkillDrafts;
      const { [sessionId]: removedTarget, ...remainingTargets } =
        state.scrollTargetMessageBySession;
      void removedTarget;
      const startedSessionIds = new Set(state.startedSessionIds);
      startedSessionIds.delete(sessionId);
      return {
        messagesBySession: rest,
        sessionStateById: remainingSessionState,
        sessionRuntimeViewById: remainingRuntimeViews,
        sessionMessageCountById: remainingMessageCounts,
        startedSessionIds,
        queuedMessageBySession: remainingQueued,
        draftsBySession: remainingDrafts,
        skillDraftsBySession: remainingSkillDrafts,
        scrollTargetMessageBySession: remainingTargets,
        activeSessionId:
          state.activeSessionId === sessionId ? null : state.activeSessionId,
      };
    });
    persistDrafts(get().draftsBySession);
  },
}));
