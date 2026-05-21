import type { ChatStore } from "./chatStore";

export const selectMessagesBySession = (state: ChatStore) =>
  state.messagesBySession;

export const selectSessionStateById = (state: ChatStore) =>
  state.sessionStateById;

export const selectSessionMessageCountById = (state: ChatStore) =>
  state.sessionMessageCountById;

export const selectStartedSessionIds = (state: ChatStore) =>
  state.startedSessionIds;

export const selectSessionRuntimeViewById = (state: ChatStore) =>
  state.sessionRuntimeViewById;
