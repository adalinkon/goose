import type {
  SessionNotification,
  SessionUpdate,
} from "@agentclientprotocol/sdk";
import type {
  Message,
  MessageContent,
  ToolRequestContent,
  ToolResponseContent,
} from "@/shared/types/messages";

export type SessionHydrationPhase =
  | "idle"
  | "hydrating"
  | "attached-runtime"
  | "ready"
  | "failed";

export interface SessionRuntimeView {
  phase: SessionHydrationPhase;
  activeRequestId: string | null;
  lastSeq: number;
  isResponding: boolean;
  isVisible: boolean;
  hasUnread: boolean;
}

export type NotificationClass =
  | "runtime-snapshot"
  | "history-replay"
  | "runtime-replay"
  | "live";

export type ChatRuntimeEvent =
  | {
      type: "agentText";
      sessionId: string;
      messageId?: string;
      text: string;
      seq?: number;
    }
  | {
      type: "toolRequest";
      sessionId: string;
      messageId?: string;
      tool: ToolRequestContent;
      seq?: number;
    }
  | {
      type: "toolPatch";
      sessionId: string;
      toolCallId: string;
      patch: Partial<ToolRequestContent>;
      seq?: number;
    }
  | {
      type: "toolResponse";
      sessionId: string;
      toolCallId: string;
      response: ToolResponseContent;
      seq?: number;
    }
  | {
      type: "appendContent";
      sessionId: string;
      messageId?: string;
      content: MessageContent;
      seq?: number;
    }
  | {
      type: "mcpApp";
      sessionId: string;
      toolCallId: string;
      toolCallTitle: string;
      update: SessionUpdate;
      seq?: number;
    }
  | {
      type: "complete";
      sessionId: string;
      seq?: number;
    }
  | {
      type: "runtimeSnapshot";
      sessionId: string;
      activeRequestId: string | null;
      lastSeq: number;
    };

export interface RuntimeSnapshot {
  sessionId: string;
  activeRequestId: string | null;
  lastSeq: number;
}

export interface RuntimeNotificationMeta {
  seq?: number;
  kind?: string;
  delivery?: string;
  requestId?: string;
  messageId?: string;
  created?: number;
  runtimeEvent?: {
    protocolVersion: 1;
    eventId: string;
    seq: number;
    kind: string;
    delivery: "replay" | "snapshot";
    requestId?: string;
    messageId?: string;
    toolCallId?: string;
  };
  protocolViolation?: string;
  replayTooOld?: boolean;
  runtime?: RuntimeSnapshot;
}

export interface SessionLiveBuffer {
  messageId: string | null;
  pendingText: string;
  pendingEvents: ChatRuntimeEvent[];
  dirty: boolean;
}

export type RuntimeSessionNotification = SessionNotification & {
  update: SessionUpdate;
  _meta?: unknown;
};

export interface MaterializedSession {
  sessionId: string;
  messages: Message[];
}

export const INITIAL_SESSION_RUNTIME_VIEW: SessionRuntimeView = {
  phase: "idle",
  activeRequestId: null,
  lastSeq: 0,
  isResponding: false,
  isVisible: false,
  hasUnread: false,
};
