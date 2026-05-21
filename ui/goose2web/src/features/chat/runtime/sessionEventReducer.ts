import type { SessionUpdate } from "@agentclientprotocol/sdk";
import { useChatStore } from "@/features/chat/stores/chatStore";
import { useChatSessionStore } from "@/features/chat/stores/chatSessionStore";
import { getBufferedMessage } from "@/features/chat/hooks/replayBuffer";
import { handleReplayUserMessageChunk } from "@/shared/api/acpSkillReplayChips";
import {
  attachMcpAppPayload,
  extractToolResultText,
  extractToolStructuredContent,
  findReplayMessageWithToolCall,
} from "@/shared/api/acpToolCallContent";
import {
  clearReplayAssistantMessage,
  ensureReplayAssistantMessage,
  getTrackedReplayAssistantMessageId,
} from "@/shared/api/acpReplayAssistant";
import {
  getReplayCreated,
  getReplayMessageId,
} from "@/shared/api/acpReplayMetadata";
import { handleSessionInfoUpdate } from "@/shared/api/acpSessionInfoUpdate";
import {
  getToolCallIdentity,
  getToolChainSummary,
} from "@/shared/api/acpToolCallIdentity";
import type {
  ToolCallLocation,
  ToolKind,
  ToolRequestContent,
} from "@/shared/types/messages";
import { getPresetMessageId, clearActiveMessageId } from "./streamTracking";
import type { SessionLiveBuffer } from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rawInputToArguments(rawInput: unknown): Record<string, unknown> {
  return isRecord(rawInput) ? rawInput : {};
}

function toolKindFromUpdate(update: SessionUpdate): ToolKind | undefined {
  const record: Record<string, unknown> = update;
  const value = record.kind;
  return typeof value === "string" ? (value as ToolKind) : undefined;
}

function locationsFromUpdate(
  update: SessionUpdate,
): ToolCallLocation[] | undefined {
  const record: Record<string, unknown> = update;
  const value = record.locations;
  if (!Array.isArray(value)) return undefined;

  return value
    .filter(
      (location): location is { path: string; line?: number | null } =>
        isRecord(location) && typeof location.path === "string",
    )
    .map((location) => ({
      path: location.path,
      ...(typeof location.line === "number" || location.line === null
        ? { line: location.line }
        : {}),
    }));
}

function toolCallUpdatePatch(
  update: SessionUpdate,
): Pick<Partial<ToolRequestContent>, "toolKind" | "locations"> {
  const toolKind = toolKindFromUpdate(update);
  const locations = locationsFromUpdate(update);

  return {
    ...(toolKind ? { toolKind } : {}),
    ...(locations ? { locations } : {}),
  };
}

function getChunkMessageId(update: SessionUpdate): string | null {
  return "messageId" in update && typeof update.messageId === "string"
    ? update.messageId
    : null;
}

export function applyHistoryReplayUpdate(
  sessionId: string,
  update: SessionUpdate,
): void {
  switch (update.sessionUpdate) {
    case "agent_message_chunk": {
      const msg = ensureReplayAssistantMessage(
        sessionId,
        getReplayMessageId(update),
        getReplayCreated(update),
      );
      if (msg && update.content.type === "text" && "text" in update.content) {
        const last = msg.content[msg.content.length - 1];
        if (last?.type === "text") {
          (last as { type: "text"; text: string }).text += update.content.text;
        } else {
          msg.content.push({ type: "text", text: update.content.text });
        }
      }
      break;
    }

    case "user_message_chunk": {
      clearReplayAssistantMessage(sessionId);
      if (update.content.type !== "text" || !("text" in update.content)) break;
      const messageId = getReplayMessageId(update) ?? crypto.randomUUID();
      handleReplayUserMessageChunk(
        sessionId,
        messageId,
        update.content,
        getReplayCreated(update),
      );
      break;
    }

    case "tool_call": {
      const created = getReplayCreated(update);
      const identity = getToolCallIdentity(update);
      const chainSummary = getToolChainSummary(update);
      const msg = ensureReplayAssistantMessage(
        sessionId,
        getReplayMessageId(update),
        created,
      );
      msg.content.push({
        type: "toolRequest",
        id: update.toolCallId,
        name: update.title,
        ...identity,
        arguments: rawInputToArguments(update.rawInput),
        status: "in_progress",
        ...toolCallUpdatePatch(update),
        startedAt: created ?? Date.now(),
        ...(chainSummary ? { chainSummary } : {}),
      });
      break;
    }

    case "tool_call_update": {
      const created = getReplayCreated(update);
      const replayMessageId = getReplayMessageId(update);
      const identity = getToolCallIdentity(update);
      const chainSummary = getToolChainSummary(update);
      const trackedMessageId = getTrackedReplayAssistantMessageId(sessionId);
      const replayMsg = replayMessageId
        ? getBufferedMessage(sessionId, replayMessageId)
        : undefined;
      const trackedMsg =
        trackedMessageId && trackedMessageId !== replayMessageId
          ? getBufferedMessage(sessionId, trackedMessageId)
          : undefined;
      const existingMsg = findReplayMessageWithToolCall(
        sessionId,
        update.toolCallId,
      );
      const msg = existingMsg ?? replayMsg ?? trackedMsg;
      if (!msg) break;

      if (created !== undefined && !existingMsg && msg === replayMsg) {
        msg.created = created;
      }
      const patch = toolCallUpdatePatch(update);
      const tc = msg.content.find(
        (c) => c.type === "toolRequest" && c.id === update.toolCallId,
      );
      if (
        tc?.type === "toolRequest" &&
        (update.title ||
          Object.keys(identity).length > 0 ||
          Object.keys(patch).length > 0 ||
          chainSummary)
      ) {
        Object.assign(tc as ToolRequestContent, {
          ...(update.title ? { name: update.title } : {}),
          ...identity,
          ...patch,
          ...(chainSummary ? { chainSummary } : {}),
        });
      }
      if (update.status === "completed" || update.status === "failed") {
        if (tc?.type === "toolRequest") {
          const idx = msg.content.indexOf(tc);
          if (idx >= 0) {
            msg.content[idx] = {
              ...tc,
              ...identity,
              ...toolCallUpdatePatch(update),
              status: update.status,
            } as ToolRequestContent;
          }
        }
        msg.content.push({
          type: "toolResponse",
          id: update.toolCallId,
          name: (tc as ToolRequestContent)?.name ?? "",
          result: extractToolResultText(update),
          structuredContent: extractToolStructuredContent(update),
          isError: update.status === "failed",
        });
        if (update.status === "completed") {
          attachMcpAppPayload(
            sessionId,
            update.toolCallId,
            (tc as ToolRequestContent)?.name ?? update.title ?? "",
            update,
            true,
            { replayMessageId },
          );
        }
      }
      break;
    }

    case "session_info_update":
    case "config_option_update":
    case "usage_update":
      applySharedUpdate(sessionId, update);
      break;

    default:
      break;
  }
}

export function reduceLiveUpdateToBuffer(
  sessionId: string,
  update: SessionUpdate,
  buffer: SessionLiveBuffer,
): void {
  switch (update.sessionUpdate) {
    case "agent_message_chunk": {
      const messageId = getChunkMessageId(update) ?? buffer.messageId;
      if (messageId) buffer.messageId = messageId;
      if (update.content.type === "text" && "text" in update.content) {
        const lastEvent = buffer.pendingEvents.at(-1);
        if (
          lastEvent?.type === "agentText" &&
          lastEvent.messageId === (messageId ?? undefined)
        ) {
          lastEvent.text += update.content.text;
        } else {
          buffer.pendingEvents.push({
            type: "agentText",
            sessionId,
            messageId: messageId ?? undefined,
            text: update.content.text,
          });
        }
        buffer.dirty = true;
      }
      break;
    }

    case "tool_call": {
      const identity = getToolCallIdentity(update);
      const chainSummary = getToolChainSummary(update);
      buffer.pendingEvents.push({
        type: "toolRequest",
        sessionId,
        messageId: buffer.messageId ?? undefined,
        tool: {
          type: "toolRequest",
          id: update.toolCallId,
          name: update.title,
          ...identity,
          arguments: rawInputToArguments(update.rawInput),
          status: "in_progress",
          ...toolCallUpdatePatch(update),
          startedAt: Date.now(),
          ...(chainSummary ? { chainSummary } : {}),
        },
      });
      buffer.dirty = true;
      break;
    }

    case "tool_call_update": {
      const identity = getToolCallIdentity(update);
      const chainSummary = getToolChainSummary(update);
      const patch = {
        ...(update.title ? { name: update.title } : {}),
        ...identity,
        ...toolCallUpdatePatch(update),
        ...(chainSummary ? { chainSummary } : {}),
      };
      if (Object.keys(patch).length > 0) {
        buffer.pendingEvents.push({
          type: "toolPatch",
          sessionId,
          toolCallId: update.toolCallId,
          patch,
        });
      }

      if (update.status === "completed" || update.status === "failed") {
        buffer.pendingEvents.push({
          type: "toolPatch",
          sessionId,
          toolCallId: update.toolCallId,
          patch: {
            ...identity,
            ...toolCallUpdatePatch(update),
            status: update.status,
          },
        });
        buffer.pendingEvents.push({
          type: "toolResponse",
          sessionId,
          toolCallId: update.toolCallId,
          response: {
            type: "toolResponse",
            id: update.toolCallId,
            name: update.title ?? "",
            result: extractToolResultText(update),
            structuredContent: extractToolStructuredContent(update),
            isError: update.status === "failed",
          },
        });
        if (update.status === "completed") {
          buffer.pendingEvents.push({
            type: "mcpApp",
            sessionId,
            toolCallId: update.toolCallId,
            toolCallTitle: update.title ?? "",
            update,
          });
        }
      }
      buffer.dirty = true;
      break;
    }

    case "session_info_update":
    case "config_option_update":
    case "usage_update":
      applySharedUpdate(sessionId, update);
      break;

    default:
      break;
  }
}

export function flushLiveBufferToStore(
  sessionId: string,
  buffer: SessionLiveBuffer,
): void {
  const store = useChatStore.getState();
  let messageId: string | null = null;
  const ensureMessageId = (preferredMessageId?: string | null) => {
    messageId = ensureLiveAssistantMessage(
      sessionId,
      preferredMessageId ?? messageId ?? buffer.messageId,
    );
    return messageId;
  };

  for (const event of buffer.pendingEvents) {
    switch (event.type) {
      case "agentText": {
        const targetMessageId = ensureMessageId(event.messageId);
        store.setStreamingMessageId(sessionId, targetMessageId);
        store.appendTextByMessageId(sessionId, targetMessageId, event.text);
        break;
      }
      case "toolRequest": {
        const targetMessageId = ensureMessageId(event.messageId);
        store.setStreamingMessageId(sessionId, targetMessageId);
        store.appendToolRequest(sessionId, targetMessageId, event.tool);
        break;
      }
      case "toolPatch": {
        store.patchToolRequest(sessionId, event.toolCallId, event.patch);
        break;
      }
      case "toolResponse": {
        const request = findLiveToolRequest(sessionId, event.toolCallId);
        store.appendToolResponse(sessionId, event.toolCallId, {
          ...event.response,
          name: request?.name ?? event.response.name,
        });
        break;
      }
      case "appendContent": {
        const targetMessageId = ensureMessageId(event.messageId);
        store.appendContentByMessageId(
          sessionId,
          targetMessageId,
          event.content,
        );
        break;
      }
      case "mcpApp": {
        const request = findLiveToolRequest(sessionId, event.toolCallId);
        attachMcpAppPayload(
          sessionId,
          event.toolCallId,
          request?.name ?? event.toolCallTitle,
          event.update,
          false,
        );
        break;
      }
      case "complete":
      case "runtimeSnapshot":
        break;
    }
  }
}

export function completeStreamingMessage(sessionId: string): void {
  const store = useChatStore.getState();
  const { streamingMessageId } = store.getSessionRuntime(sessionId);
  if (streamingMessageId) {
    store.updateMessage(sessionId, streamingMessageId, (message) => ({
      ...message,
      metadata: {
        ...message.metadata,
        completionStatus:
          message.metadata?.completionStatus === "stopped"
            ? "stopped"
            : "completed",
      },
    }));
  }
  store.setChatState(sessionId, "idle");
  store.setStreamingMessageId(sessionId, null);
}

function applySharedUpdate(sessionId: string, update: SessionUpdate): void {
  switch (update.sessionUpdate) {
    case "session_info_update":
      handleSessionInfoUpdate(sessionId, update);
      break;

    case "config_option_update": {
      const configUpdate = update as SessionUpdate & {
        sessionUpdate: "config_option_update";
      };
      if ("options" in configUpdate && Array.isArray(configUpdate.options)) {
        const modelOption = configUpdate.options.find(
          (opt: { category?: string; kind?: Record<string, unknown> }) =>
            opt.category === "model",
        );
        if (modelOption?.kind?.type === "select") {
          const select = modelOption.kind;
          const currentModelId = select.currentValue;
          const availableModels: Array<{ id: string; name: string }> = [];

          if (select.options?.type === "ungrouped") {
            for (const v of select.options.values) {
              availableModels.push({ id: v.value, name: v.name });
            }
          } else if (select.options?.type === "grouped") {
            for (const group of select.options.groups) {
              for (const v of group.options) {
                availableModels.push({ id: v.value, name: v.name });
              }
            }
          }

          const currentModelName =
            availableModels.find((m) => m.id === currentModelId)?.name ??
            currentModelId;

          useChatSessionStore.getState().patchSession(sessionId, {
            modelId: currentModelId,
            modelName: currentModelName,
          });
        }
      }
      break;
    }

    case "usage_update": {
      const usage = update as SessionUpdate & { sessionUpdate: "usage_update" };

      useChatStore.getState().updateTokenState(sessionId, {
        accumulatedTotal: usage.used,
        contextLimit: usage.size,
      });
      break;
    }

    default:
      break;
  }
}

function findLiveToolRequest(
  sessionId: string,
  toolCallId: string,
): ToolRequestContent | null {
  const messages = useChatStore.getState().messagesBySession[sessionId];
  if (!messages) return null;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const request = messages[i].content.find(
      (content): content is ToolRequestContent =>
        content.type === "toolRequest" && content.id === toolCallId,
    );
    if (request) return request;
  }
  return null;
}

function findStreamingMessageId(sessionId: string): string | null {
  return useChatStore.getState().getSessionRuntime(sessionId)
    .streamingMessageId;
}

function ensureLiveAssistantMessage(
  sessionId: string,
  preferredMessageId?: string | null,
): string {
  const store = useChatStore.getState();
  const existingStreamingMessageId = findStreamingMessageId(sessionId);
  const messages = store.messagesBySession[sessionId] ?? [];

  if (
    preferredMessageId &&
    messages.some((message) => message.id === preferredMessageId)
  ) {
    store.setPendingAssistantProvider(sessionId, null);
    store.setStreamingMessageId(sessionId, preferredMessageId);
    clearActiveMessageId(sessionId);
    return preferredMessageId;
  }

  if (
    !preferredMessageId &&
    existingStreamingMessageId &&
    messages.some((message) => message.id === existingStreamingMessageId)
  ) {
    return existingStreamingMessageId;
  }

  const messageId =
    preferredMessageId ??
    getPresetMessageId(sessionId) ??
    existingStreamingMessageId ??
    crypto.randomUUID();

  if (!messages.some((message) => message.id === messageId)) {
    store.appendMessage(sessionId, {
      id: messageId,
      role: "assistant",
      created: Date.now(),
      content: [],
      metadata: {
        userVisible: true,
        agentVisible: true,
        completionStatus: "inProgress",
      },
    });
  }

  store.setPendingAssistantProvider(sessionId, null);
  store.setStreamingMessageId(sessionId, messageId);
  clearActiveMessageId(sessionId);

  return messageId;
}
