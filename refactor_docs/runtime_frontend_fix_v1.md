# Frontend Exact Runtime Replay / WS Decoupling Fix Plan v1

This document is for a frontend-focused agent with no prior context. Work on `replay/goose2web-onto-main`. The imported source branch is `goose2web`.

The target is exact replay merging. Do not implement runtime replay by guessing a target message from current streaming state. The backend plan requires a protocol change first: runtime replay chat events must carry stable `_meta.goose.messageId` matching history replay.

## Diff Scope

Inspect the goose2web runtime/ws decoupling diff from:

```bash
git diff ffd2349b0ef21fade875714bdabc4eae9e3c5ce9..b09d4046b192b3fc6cc453a8c2e237cc7d2bc1a7 -- <files>
```

Known refs:

- base: `ffd2349b0ef21fade875714bdabc4eae9e3c5ce9`
- source branch head: `goose2web` / `origin/goose2web` at `b09d4046b192b3fc6cc453a8c2e237cc7d2bc1a7`
- replay integration currently observed at `9c7b5acdf4028c694e4a322023b6b06f904c0a4f`

Do not inspect or fix REST API / streamhttp backend modules for this task.

## Frontend Files To Inspect

- `ui/goose2web/src/shared/api/acpConnection.ts`
- `ui/goose2web/src/shared/api/acpNotificationHandler.ts`
- `ui/goose2web/src/shared/api/acp.ts`
- `ui/goose2web/src/shared/api/acpApi.ts`
- `ui/goose2web/src/shared/api/acpReplayAssistant.ts`
- `ui/goose2web/src/shared/api/acpReplayMetadata.ts`
- `ui/goose2web/src/shared/api/acpToolCallContent.ts`
- `ui/goose2web/src/shared/api/acpToolCallIdentity.ts`
- `ui/goose2web/src/features/chat/runtime/types.ts`
- `ui/goose2web/src/features/chat/runtime/metadata.ts`
- `ui/goose2web/src/features/chat/runtime/notificationClassifier.ts`
- `ui/goose2web/src/features/chat/runtime/sessionRuntimeCoordinator.ts`
- `ui/goose2web/src/features/chat/runtime/sessionHydrator.ts`
- `ui/goose2web/src/features/chat/runtime/sessionEventReducer.ts`
- `ui/goose2web/src/features/chat/runtime/sessionBuffers.ts`
- `ui/goose2web/src/features/chat/runtime/streamTracking.ts`
- `ui/goose2web/src/features/chat/runtime/flushScheduler.ts`
- `ui/goose2web/src/features/chat/runtime/replayPerf.ts`
- `ui/goose2web/src/features/chat/runtime/selectors.ts`
- `ui/goose2web/src/features/chat/runtime/sessionIndexes.ts`
- `ui/goose2web/src/features/chat/hooks/replayBuffer.ts`
- `ui/goose2web/src/features/chat/hooks/useChat.ts`
- `ui/goose2web/src/features/chat/hooks/useChatSessionController.ts`
- `ui/goose2web/src/features/chat/stores/chatStore.ts`
- `ui/goose2web/src/features/chat/stores/chatSessionStore.ts`
- `ui/goose2web/src/features/chat/types.ts`

Backend protocol reference files:

- `crates/goose/src/acp/session_events.rs`
- `crates/goose/src/acp/server.rs`

Useful commands:

```bash
git diff ffd2349b0ef21fade875714bdabc4eae9e3c5ce9..b09d4046b192b3fc6cc453a8c2e237cc7d2bc1a7 -- ui/goose2web/src/shared/api/acpConnection.ts ui/goose2web/src/shared/api/acpNotificationHandler.ts ui/goose2web/src/shared/api/acp.ts ui/goose2web/src/shared/api/acpApi.ts ui/goose2web/src/shared/api/acpReplayAssistant.ts ui/goose2web/src/shared/api/acpReplayMetadata.ts ui/goose2web/src/features/chat/runtime ui/goose2web/src/features/chat/hooks/replayBuffer.ts ui/goose2web/src/features/chat/hooks/useChat.ts ui/goose2web/src/features/chat/hooks/useChatSessionController.ts ui/goose2web/src/features/chat/stores/chatStore.ts ui/goose2web/src/features/chat/stores/chatSessionStore.ts ui/goose2web/src/features/chat/types.ts
rg -n "requestPermission|monitorConnection|ensureSessionLoaded|runtime-replay|lastSeq|seq|hydrateSession|loadSession|processedSeq|messageId|activeRequestId" ui/goose2web/src
```

## Required Backend Protocol

Do not begin exact runtime replay implementation until backend emits this metadata for runtime replay chat events.

Every replayable runtime chat notification must include top-level `_meta` like:

```json
{
  "seq": 12,
  "sessionId": "session-id",
  "kind": "chat.agent_chunk",
  "delivery": "replay",
  "createdAt": "2026-05-22T10:00:00Z",
  "requestId": "active-request-id",
  "goose": {
    "messageId": "persisted-assistant-message-id",
    "created": 1710000000000,
    "requestId": "active-request-id",
    "runtime": {
      "protocolVersion": 1,
      "eventId": "session-id:12",
      "seq": 12,
      "kind": "chat.agent_chunk",
      "delivery": "replay",
      "requestId": "active-request-id",
      "messageId": "persisted-assistant-message-id",
      "toolCallId": "tool-call-id-if-applicable"
    }
  }
}
```

Mandatory for exact frontend merging:

- `goose.messageId` on every runtime `agent_message_chunk`, `agent_thought_chunk`, `tool_call`, and message-bound `tool_call_update`.
- `goose.created` matching the persisted message timestamp when available.
- `goose.runtime.protocolVersion === 1`.
- `goose.runtime.eventId` unique per runtime event, expected format `"{sessionId}:{seq}"`.
- `goose.runtime.toolCallId` on tool events.
- History replay and runtime replay for the same assistant row must use the same `goose.messageId`.

If a replayable runtime chat event lacks `goose.messageId`, treat it as a protocol violation. Do not append it to an inferred message.

Session-level events such as `usage_update` do not need `messageId`, but must have `seq/kind/delivery` and `goose.runtime.eventId`.

## Frontend Fixes

### 1. Parse Runtime Replay Protocol Metadata

Problem:

Current `metadata.ts` only parses `seq`, `kind`, `delivery`, and runtime snapshot. Existing `acpReplayMetadata.ts` can read `_meta.goose.messageId`, but runtime coordinator does not enforce message identity.

Required change:

- Extend runtime types:
  - `RuntimeNotificationMeta.runtimeEvent?: { protocolVersion: 1; eventId: string; seq: number; kind: string; delivery: "replay" | "snapshot"; requestId?: string; messageId?: string; toolCallId?: string }`
  - `RuntimeNotificationMeta.messageId?: string`
  - `RuntimeNotificationMeta.created?: number`
  - `RuntimeNotificationMeta.requestId?: string`
- Parse from merged notification/update `_meta`:
  - top-level `seq/kind/delivery/requestId`
  - `_meta.goose.messageId`
  - `_meta.goose.created`
  - `_meta.goose.runtime`
- Validate protocol version when `goose.runtime` exists.
- Keep existing history replay helpers, but make runtime reducer use the same `getReplayMessageId` semantics.

Tests:

- Parses message id from notification-level `_meta.goose.messageId`.
- Preserves update-level tool identity while reading notification-level runtime identity.
- Rejects or flags runtime protocol version other than `1`.

### 2. Reattach Active Sessions After Websocket Reconnect

Problem:

`acpConnection.ts::monitorConnection()` only clears client state. `sessionRuntimeCoordinator.ensureSessionLoaded()` returns early for `ready` / `attached-runtime`, so reconnect does not force `loadSession(lastSeq)`.

Required change:

- Add connection generation or reconnect event in `acpConnection.ts`.
- Expose `onAcpConnectionReconnected(listener)` or equivalent.
- On successful `initializeConnection`, increment generation and notify listeners.
- In `sessionRuntimeCoordinator`, track attached generation per session.
- Force `hydrateSession(sessionId, { lastSeq })` when connection generation is newer than the session's attached generation, even if phase is `ready` or `attached-runtime`.
- Add `reattachActiveSessions()` for sessions that are visible, active, or `isResponding`; call it on reconnect success.
- Preserve current `lastSeq` during forced reattach.

Tests:

- Ready session with old generation hydrates with prior `lastSeq` after reconnect.
- Existing load promise prevents duplicate hydrate.

### 3. Advance `lastSeq` On Every Accepted Runtime Event

Problem:

`enqueueNotification()` marks `processedSeq`, but does not update `sessionRuntimeView.lastSeq`. Later `loadSession(lastSeq)` can ask backend for events already processed.

Required change:

- After duplicate rejection and before applying an event, update `lastSeq = max(current.lastSeq, meta.seq)`.
- Keep processed seq tracking bounded with a sliding window or pruning.
- Never lower `lastSeq` for out-of-order older events.

Tests:

- seq `5` advances lastSeq from `3` to `5`.
- duplicate seq does not append content twice.
- older seq after newer seq does not lower lastSeq.

### 4. Implement Exact `runtime-replay` Reducer

Problem:

`notificationClassifier.ts` returns `"runtime-replay"`, but `sessionRuntimeCoordinator.ts` sends it through live buffering. That creates wrong assistant rows when replay lacks stable target state.

Required change:

- Add a dedicated `runtime-replay` branch in `SessionRuntimeCoordinator.enqueueNotification`.
- For chat content events (`agent_message_chunk`, `agent_thought_chunk`, `tool_call`, message-bound `tool_call_update`):
  - Require `meta.messageId` / `_meta.goose.messageId`.
  - Use `messageId` as the only target assistant row key.
  - If target message exists in store or hydration replay buffer, update it.
  - If target message does not exist and event belongs to active runtime tail, create one assistant row with that exact id and `created`.
  - If target message does not exist and event does not belong to active runtime tail, record a protocol/order error and defer until history replay completes. Do not create random ids.
- For `tool_call`:
  - Append tool request only if that `toolCallId` is not already present in the target message.
- For `tool_call_update`:
  - Patch existing tool request by `toolCallId`.
  - Append tool response only if a response for `toolCallId` with same final status/content is not already present.
  - Use `goose.runtime.toolCallId` to verify consistency with ACP `toolCallId`.
- For text/thought chunks:
  - Use event id or seq to ensure idempotency.
  - Do not append the same runtime event twice to the same message.
- For `usage_update`, use shared update handling; no message id required.
- For runtime snapshot, existing snapshot handling remains authoritative for `activeRequestId`.

Data structures:

- Add per-session processed runtime event ids: `processedRuntimeEventIdsBySession`.
- Add per-message applied seq/event tracking if needed to avoid duplicate text append.
- Add a deferred runtime replay queue keyed by `messageId` for events that arrive before history replay materializes the message.
- Flush deferred events after `hydrateSession` applies history replay buffer.

Tests:

- Runtime replay and history replay for same `messageId` produce one assistant row.
- Duplicate runtime event id does not duplicate text.
- Tool call replay does not duplicate tool request if history already added it.
- Tool call completion replay does not duplicate tool response.
- Missing `goose.messageId` on runtime chat replay is rejected/deferred as protocol violation and does not create random assistant message.

### 5. Define Hydration Ordering Behavior

Problem:

During `loadSession`, notifications can arrive before `hydrateSession` swaps replay buffer into store.

Required change:

- `hydrateSession` phases:
  1. set phase `hydrating`
  2. clear history replay buffer and runtime deferred queue for session
  3. call `acpLoadSession(sessionId, { lastSeq })`
  4. collect history replay into replay buffer
  5. apply replay buffer to store
  6. apply deferred runtime replay by exact `messageId`
  7. set phase `attached-runtime` if active request exists, else `ready`
- If backend sends `_meta.replayTooOld`, ignore partial runtime replay, clear seq processed window for that session, and force a full history reload with `lastSeq = 0`.
- Do not skip history replay on fresh load just because runtime replay exists. Exact merge requires history and runtime to share `messageId`.

Tests:

- Runtime replay arriving before history replay is deferred, then applied to the matching history message.
- `replayTooOld` triggers full reload behavior.

### 6. Replace Permission Auto-Allow

Problem:

`acpConnection.ts::requestPermission` returns `args.options?.[0]`. Backend currently sends `AllowAlways` first, so web silently grants permanent permission.

Required change:

- Remove auto-approve.
- Implement a real permission UI or fail closed.
- Minimum safe behavior if UI is out of scope: return cancelled or select `reject_once`.
- Preferred:
  - Add permission request store/state with session id, tool title, raw input, options.
  - Render modal/dialog in app shell or active chat.
  - Resolve callback promise only after explicit user choice.
  - Dismiss/close/timeout cancels or rejects.
- Never return `AllowAlways` unless explicitly selected by user.

Tests:

- `AllowAlways` first does not resolve to `AllowAlways` without user action.
- Dismiss/cancel resolves to cancelled or reject once.
- Explicit AllowOnce returns AllowOnce option id.

### 7. Audit Streaming State Against Runtime Snapshot

Problem:

`useChat.ts` sets `chatState` to `idle` after `acpSendMessage()` resolves. With decoupled runtime, prompt RPC and runtime delivery can race.

Required change:

- Do not hide streaming solely because prompt RPC returned while `sessionRuntimeView.isResponding` / `activeRequestId` is still set.
- Prefer runtime snapshot `activeRequestId: null` in coordinator to complete streaming message and set idle.
- Keep error paths marking message error and setting idle.

Tests:

- Prompt RPC resolves while active runtime remains set; UI stays streaming.
- Runtime snapshot with no active request completes message and sets idle.

## Acceptance Criteria

- Reconnect during a running prompt triggers `loadSession(lastSeq)` for active/responding session.
- Runtime replay chat events merge only by `_meta.goose.messageId`; no random/inferred target ids.
- Runtime replay plus history replay for the same message yields exactly one assistant row.
- Text/tool events are idempotent by `goose.runtime.eventId` or seq.
- `lastSeq` advances on accepted seq-bearing runtime events.
- Missing required runtime protocol fields do not corrupt the transcript.
- Permission prompts do not auto-allow.
- Existing normal chat send, history load, tool rendering, and usage display still work.

## Verification

Run only if asked to build/test:

```bash
cd ui/goose2web
pnpm test
pnpm exec vitest run src/features/chat/runtime src/shared/api
```

Manual E2E:

1. Start backend and goose2web UI with backend Runtime Replay Meta v1 implemented.
2. Send a long-running prompt that emits text and tool calls.
3. Close or kill websocket without killing backend runtime.
4. Reconnect UI.
5. Confirm active session calls `loadSession(lastSeq)`.
6. Confirm history replay and runtime replay sharing the same `goose.messageId` produce one assistant row.
7. Confirm no duplicate tool request or tool response.
8. Confirm streaming clears when runtime snapshot clears active request and usage is current.
9. Trigger a tool permission request and confirm UI asks instead of auto-selecting `AllowAlways`.
