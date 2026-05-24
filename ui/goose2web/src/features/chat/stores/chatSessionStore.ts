import { create } from "zustand";
import {
  acpCreateSession,
  acpListSessions,
  type AcpSessionInfo,
} from "@/shared/api/acp";
import type {
  Session,
  SessionIndexRuntime,
  SessionIndexStatus,
} from "@/shared/types/chat";
import {
  DEFAULT_CHAT_TITLE,
  normalizeAcpTitle,
} from "@/features/chat/lib/sessionTitle";
import {
  archiveSession as acpArchiveSession,
  unarchiveSession as acpUnarchiveSession,
} from "@/shared/api/acpApi";

export interface ChatSession {
  id: string;
  title: string;
  projectId?: string | null;
  providerId?: string;
  agentId?: string;
  modelId?: string;
  modelName?: string;
  workingDir?: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
  messageCount: number;
  userSetName?: boolean;
}

export interface ActiveWorkspace {
  path: string;
  branch: string | null;
}

export function hasSessionStarted(
  session: Pick<ChatSession, "messageCount">,
  localMessages?: ArrayLike<unknown>,
): boolean {
  return session.messageCount > 0 || (localMessages?.length ?? 0) > 0;
}

export function getVisibleSessions<
  T extends Pick<ChatSession, "id" | "messageCount">,
>(
  sessions: T[],
  messagesBySession: Record<string, ArrayLike<unknown> | undefined>,
): T[] {
  return sessions.filter((session) =>
    hasSessionStarted(session, messagesBySession[session.id]),
  );
}

export function getVisibleSessionsByMessageCount<
  T extends Pick<ChatSession, "id" | "messageCount">,
>(sessions: T[], sessionMessageCountById: Record<string, number>): T[] {
  return sessions.filter(
    (session) =>
      session.messageCount > 0 ||
      (sessionMessageCountById[session.id] ?? 0) > 0,
  );
}

interface ChatSessionStoreState {
  sessions: ChatSession[];
  sessionRuntimeById: Record<string, SessionIndexRuntime>;
  activeSessionId: string | null;
  isLoading: boolean;
  hasHydratedSessions: boolean;
  contextPanelOpenBySession: Record<string, boolean>;
  activeWorkspaceBySession: Record<string, ActiveWorkspace>;
}

interface CreateSessionOpts {
  title?: string;
  projectId?: string;
  providerId?: string;
  agentId?: string;
  workingDir?: string;
  modelId?: string;
  modelName?: string;
}

interface ChatSessionStoreActions {
  createSession: (opts?: CreateSessionOpts) => Promise<ChatSession>;
  loadSessions: () => Promise<void>;
  patchSession: (id: string, patch: Partial<ChatSession>) => void;
  addSession: (session: ChatSession) => void;
  applySessionRuntime: (
    sessionId: string,
    status: SessionIndexStatus,
    revision: number,
    updatedAt?: string,
  ) => void;
  archiveSession: (id: string) => Promise<void>;
  unarchiveSession: (id: string) => Promise<void>;

  setActiveSession: (sessionId: string | null) => void;
  setContextPanelOpen: (sessionId: string, open: boolean) => void;
  setActiveWorkspace: (sessionId: string, context: ActiveWorkspace) => void;
  clearActiveWorkspace: (sessionId: string) => void;
  switchSessionProvider: (sessionId: string, providerId: string) => void;

  getSession: (id: string) => ChatSession | undefined;
  getActiveSession: () => ChatSession | null;
  getArchivedSessions: () => ChatSession[];
}

export type ChatSessionStore = ChatSessionStoreState & ChatSessionStoreActions;

function acpSessionToChatSession(session: AcpSessionInfo): ChatSession {
  const now = new Date().toISOString();
  return {
    id: session.sessionId,
    title: normalizeAcpTitle(session.title) ?? "Untitled",
    projectId: session.projectId ?? undefined,
    providerId: session.providerId ?? undefined,
    modelId: session.modelId ?? undefined,
    workingDir: session.workingDir ?? undefined,
    createdAt: session.createdAt ?? session.updatedAt ?? now,
    updatedAt: session.updatedAt ?? now,
    archivedAt: session.archivedAt ?? undefined,
    messageCount: session.messageCount,
    userSetName: session.userSetName,
  };
}

function sortByUpdatedAtDesc(sessions: ChatSession[]): ChatSession[] {
  return [...sessions].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
}

export function sessionToChatSession(session: Session): ChatSession {
  return {
    id: session.id,
    title: session.title,
    projectId: session.projectId,
    providerId: session.providerId,
    modelId: session.modelId,
    modelName: session.modelName,
    workingDir: session.workingDir,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    archivedAt: session.archivedAt,
    messageCount: session.messageCount,
    userSetName: session.userSetName,
  };
}

export const useChatSessionStore = create<ChatSessionStore>((set, get) => ({
  sessions: [],
  sessionRuntimeById: {},
  activeSessionId: null,
  isLoading: false,
  hasHydratedSessions: false,
  contextPanelOpenBySession: {},
  activeWorkspaceBySession: {},

  createSession: async (opts) => {
    if (!opts?.workingDir) {
      throw new Error("createSession requires a working directory");
    }
    const now = new Date().toISOString();
    const providerId = opts.providerId ?? "goose";
    const { sessionId } = await acpCreateSession(providerId, opts.workingDir, {
      modelId: opts.modelId,
      projectId: opts.projectId,
    });
    const chatSession: ChatSession = {
      id: sessionId,
      title: opts.title ?? DEFAULT_CHAT_TITLE,
      projectId: opts.projectId,
      providerId,
      agentId: opts.agentId,
      modelId: opts.modelId,
      modelName: opts.modelName,
      workingDir: opts.workingDir,
      createdAt: now,
      updatedAt: now,
      messageCount: 0,
    };
    set((state) => ({ sessions: [chatSession, ...state.sessions] }));
    return chatSession;
  },

  loadSessions: async () => {
    set({ isLoading: true });
    try {
      const acpSessions = await acpListSessions({ includeArchived: false });
      const sessions = sortByUpdatedAtDesc(
        acpSessions.map(acpSessionToChatSession),
      );
      const runtimes = acpSessions
        .filter(
          (
            session,
          ): session is AcpSessionInfo & {
            runtimeStatus: SessionIndexStatus;
          } => Boolean(session.runtimeStatus),
        )
        .map((session) => ({
          sessionId: session.sessionId,
          status: session.runtimeStatus,
          revision: session.sessionIndexRevision ?? 0,
          updatedAt: session.updatedAt ?? undefined,
        }));
      const activeSessionId = get().activeSessionId;
      const activeSessionStillExists =
        activeSessionId == null ||
        sessions.some((session) => session.id === activeSessionId);
      set((state) => {
        const sessionRuntimeById = { ...state.sessionRuntimeById };
        for (const runtime of runtimes) {
          const current = sessionRuntimeById[runtime.sessionId];
          if (current && current.revision > runtime.revision) {
            continue;
          }
          sessionRuntimeById[runtime.sessionId] = {
            status: runtime.status,
            revision: runtime.revision,
            updatedAt: runtime.updatedAt,
          };
        }
        return {
          sessions,
          activeSessionId: activeSessionStillExists ? activeSessionId : null,
          sessionRuntimeById,
        };
      });
    } catch (error) {
      console.error("Failed to load sessions from ACP:", error);
    } finally {
      set({ isLoading: false, hasHydratedSessions: true });
    }
  },

  patchSession: (id, patch) => {
    set((state) => ({
      sessions: state.sessions.map((session) =>
        session.id === id
          ? {
              ...session,
              ...patch,
              updatedAt: patch.updatedAt ?? session.updatedAt,
            }
          : session,
      ),
    }));
  },

  addSession: (session) => {
    set((state) => {
      const existing = state.sessions.findIndex(
        (candidate) => candidate.id === session.id,
      );
      if (existing >= 0) {
        const updated = [...state.sessions];
        updated[existing] = { ...updated[existing], ...session };
        return { sessions: updated };
      }
      return { sessions: [session, ...state.sessions] };
    });
  },

  applySessionRuntime: (sessionId, status, revision, updatedAt) => {
    set((state) => {
      const current = state.sessionRuntimeById[sessionId];
      if (current && current.revision > revision) {
        return state;
      }
      return {
        sessionRuntimeById: {
          ...state.sessionRuntimeById,
          [sessionId]: {
            status,
            revision,
            updatedAt,
          },
        },
      };
    });
  },

  archiveSession: async (id) => {
    set((state) => ({
      sessions: state.sessions.map((session) =>
        session.id === id
          ? { ...session, archivedAt: new Date().toISOString() }
          : session,
      ),
      activeSessionId:
        state.activeSessionId === id ? null : state.activeSessionId,
    }));
    const session = get().sessions.find((candidate) => candidate.id === id);
    if (session) {
      acpArchiveSession(session.id).catch((err: unknown) =>
        console.error("Failed to archive session in backend:", err),
      );
    }
  },

  unarchiveSession: async (id) => {
    set((state) => ({
      sessions: state.sessions.map((session) =>
        session.id === id ? { ...session, archivedAt: undefined } : session,
      ),
    }));
    const session = get().sessions.find((candidate) => candidate.id === id);
    if (session) {
      acpUnarchiveSession(session.id).catch((err: unknown) =>
        console.error("Failed to unarchive session in backend:", err),
      );
    }
  },

  setActiveSession: (sessionId) => {
    if (get().activeSessionId === sessionId) return;
    set({ activeSessionId: sessionId });
  },

  setContextPanelOpen: (sessionId, open) => {
    set((state) => ({
      contextPanelOpenBySession: {
        ...state.contextPanelOpenBySession,
        [sessionId]: open,
      },
    }));
  },

  setActiveWorkspace: (sessionId, context) => {
    set((state) => ({
      activeWorkspaceBySession: {
        ...state.activeWorkspaceBySession,
        [sessionId]: context,
      },
    }));
  },

  clearActiveWorkspace: (sessionId) => {
    set((state) => {
      const { [sessionId]: _, ...rest } = state.activeWorkspaceBySession;
      return { activeWorkspaceBySession: rest };
    });
  },

  switchSessionProvider: (sessionId, providerId) => {
    set((state) => ({
      sessions: state.sessions.map((session) =>
        session.id === sessionId
          ? {
              ...session,
              providerId,
              modelId: undefined,
              modelName: undefined,
              updatedAt: session.updatedAt,
            }
          : session,
      ),
    }));
  },

  getSession: (id) => get().sessions.find((session) => session.id === id),

  getActiveSession: () => {
    const { activeSessionId, sessions } = get();
    if (!activeSessionId) return null;
    return sessions.find((session) => session.id === activeSessionId) ?? null;
  },

  getArchivedSessions: () =>
    get().sessions.filter((session) => !!session.archivedAt),
}));
