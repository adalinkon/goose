import type {
  Message,
  MessageContent,
  ToolRequestContent,
} from "@/shared/types/messages";

export interface ToolCallLocationIndex {
  messageId: string;
  messageIndex: number;
  contentIndex: number;
}

export interface SessionMessageIndex {
  messageIdToIndex: Map<string, number>;
  toolCallIdToLocation: Map<string, ToolCallLocationIndex>;
}

const indexes = new Map<string, SessionMessageIndex>();

function createIndex(): SessionMessageIndex {
  return {
    messageIdToIndex: new Map<string, number>(),
    toolCallIdToLocation: new Map<string, ToolCallLocationIndex>(),
  };
}

export function getSessionMessageIndex(sessionId: string): SessionMessageIndex {
  let index = indexes.get(sessionId);
  if (!index) {
    index = createIndex();
    indexes.set(sessionId, index);
  }
  return index;
}

function indexContent(
  index: SessionMessageIndex,
  message: Message,
  messageIndex: number,
): void {
  message.content.forEach((content, contentIndex) => {
    if (content.type === "toolRequest") {
      index.toolCallIdToLocation.set(content.id, {
        messageId: message.id,
        messageIndex,
        contentIndex,
      });
    }
  });
}

export function rebuildSessionMessageIndex(
  sessionId: string,
  messages: Message[],
): void {
  const index = createIndex();
  messages.forEach((message, messageIndex) => {
    index.messageIdToIndex.set(message.id, messageIndex);
    indexContent(index, message, messageIndex);
  });
  indexes.set(sessionId, index);
}

export function appendMessageToIndex(
  sessionId: string,
  message: Message,
  messageIndex: number,
): void {
  const index = getSessionMessageIndex(sessionId);
  index.messageIdToIndex.set(message.id, messageIndex);
  indexContent(index, message, messageIndex);
}

export function appendContentToIndex(
  sessionId: string,
  messageId: string,
  messageIndex: number,
  content: MessageContent,
  contentIndex: number,
): void {
  if (content.type !== "toolRequest") return;
  getSessionMessageIndex(sessionId).toolCallIdToLocation.set(content.id, {
    messageId,
    messageIndex,
    contentIndex,
  });
}

export function updateToolRequestInIndex(
  sessionId: string,
  toolCallId: string,
  content: ToolRequestContent,
): void {
  const location =
    getSessionMessageIndex(sessionId).toolCallIdToLocation.get(toolCallId);
  if (!location || content.id === toolCallId) return;

  const index = getSessionMessageIndex(sessionId);
  index.toolCallIdToLocation.delete(toolCallId);
  index.toolCallIdToLocation.set(content.id, location);
}

export function removeMessageFromIndex(sessionId: string, messageId: string) {
  const index = getSessionMessageIndex(sessionId);
  index.messageIdToIndex.delete(messageId);
  for (const [toolCallId, location] of index.toolCallIdToLocation) {
    if (location.messageId === messageId) {
      index.toolCallIdToLocation.delete(toolCallId);
    }
  }
}

export function clearSessionMessageIndex(sessionId: string): void {
  indexes.delete(sessionId);
}
