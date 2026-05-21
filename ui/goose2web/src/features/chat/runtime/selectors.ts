import type { ChatStore } from "../stores/chatStore";
import { INITIAL_SESSION_RUNTIME_VIEW } from "./types";

export const selectActiveSessionMessages =
  (sessionId: string) => (state: ChatStore) =>
    state.messagesBySession[sessionId] ?? [];

export const selectSessionRuntimeView =
  (sessionId: string) => (state: ChatStore) =>
    state.sessionRuntimeViewById[sessionId] ?? INITIAL_SESSION_RUNTIME_VIEW;

export const selectSessionMessageCountById = (state: ChatStore) =>
  state.sessionMessageCountById;

export const selectStartedSessionIds = (state: ChatStore) =>
  state.startedSessionIds;

export const selectRuntimeViewsById = (state: ChatStore) =>
  state.sessionRuntimeViewById;
