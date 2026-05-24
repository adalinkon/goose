# Backend Runtime Replay Protocol / WS Decoupling Fix Plan v1

This document is for a backend-only agent with no prior context. Work on `replay/goose2web-onto-main`. The imported source branch is `goose2web`.

The target is not "best effort". The backend must provide enough stable data for the frontend to do exact replay merging without guessing.

## Diff Scope

Inspect the runtime/ws decoupling diff from:

```bash
git diff ffd2349b0ef21fade875714bdabc4eae9e3c5ce9..b09d4046b192b3fc6cc453a8c2e237cc7d2bc1a7 -- <files>
```

Known refs:

- base: `ffd2349b0ef21fade875714bdabc4eae9e3c5ce9`
- source branch head: `goose2web` / `origin/goose2web` at `b09d4046b192b3fc6cc453a8c2e237cc7d2bc1a7`
- replay integration currently observed at `9c7b5acdf4028c694e4a322023b6b06f904c0a4f`

Do not inspect or fix REST API / streamhttp modules for this task.

## Backend Files To Inspect

- `crates/goose/src/acp/session_events.rs`
- `crates/goose/src/acp/server.rs`
- `crates/goose/src/acp/server/dispatch.rs`
- `crates/goose/src/acp/server_factory.rs`
- `crates/goose/src/acp/transport/connection.rs`
- `crates/goose/src/acp/transport/websocket.rs`

Useful commands:

```bash
git diff ffd2349b0ef21fade875714bdabc4eae9e3c5ce9..b09d4046b192b3fc6cc453a8c2e237cc7d2bc1a7 -- crates/goose/src/acp/session_events.rs crates/goose/src/acp/server.rs crates/goose/src/acp/server/dispatch.rs crates/goose/src/acp/server_factory.rs crates/goose/src/acp/transport/connection.rs crates/goose/src/acp/transport/websocket.rs
rg -n "SessionEventBus|RuntimeEvent|runtime_event_meta|publish_chat_update|publish_tool_call_update|replay_message_meta|merge_replay_message_meta|handle_message_content|active_request|set_active_request|UsageUpdate|on_prompt" crates/goose/src/acp
```

## Required Protocol: Runtime Replay Meta v1

The frontend must be able to merge runtime replay with history replay exactly. Backend must attach stable message identity to every replayable chat runtime event.

### Meta Shape

Every runtime event notification already has top-level `_meta` from `runtime_event_meta(event)`. Extend it with:

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

Rules:

- `goose.messageId` is mandatory for every replayable chat content event:
  - `agent_message_chunk`
  - `agent_thought_chunk`
  - `tool_call`
  - `tool_call_update` when it belongs to a persisted assistant message or known tool call
- `goose.created` should be the persisted `Message.created` timestamp when available. It must match history replay for the same message.
- `goose.runtime.protocolVersion` must be `1`.
- `goose.runtime.eventId` must be deterministic and unique per runtime event. Use `"{session_id}:{seq}"`.
- `goose.runtime.seq`, `kind`, `delivery`, `requestId`, `messageId`, and `toolCallId` duplicate top-level values intentionally so frontend reducers can use one namespace.
- For tool events, `goose.runtime.toolCallId` must equal ACP `toolCallId`.
- Preserve existing `goose.toolCall`, `goose.toolChainSummary`, and other metadata. Do not overwrite them when adding `messageId` / `runtime`.

### No-Guessing Requirement

If the backend cannot attach a `messageId` to a replayable chat runtime event, do not publish it as replayable chat content. Either:

- fix the publishing call site to pass the persisted message id, or
- publish a non-chat snapshot/control event that frontend can apply without message merging.

The frontend plan is allowed to treat replayable chat runtime events without `goose.messageId` as protocol violations.

## Backend Fixes

### 1. Add Runtime Event Identity To `SessionEventBus`

Problem:

`SessionEventBus::publish_chat_update` only stores `request_id` and `SessionUpdate`. `runtime_event_meta` has seq/kind/requestId but no persisted message id. Current frontend cannot exactly merge runtime replay with history replay.

Required change:

- Add a metadata struct in `session_events.rs`, for example:

```rust
#[derive(Debug, Clone)]
pub struct RuntimeEventIdentity {
    pub message_id: Option<String>,
    pub message_created: Option<i64>, // or existing timestamp type converted to JSON
    pub tool_call_id: Option<String>,
}
```

- Add `identity: RuntimeEventIdentity` to `RuntimeEvent`.
- Change publish APIs to accept identity:
  - `publish_chat_update(session_id, request_id, identity, update)`
  - `publish_tool_call_update(session_id, request_id, identity, update)`
  - optionally add typed helpers `publish_message_update(...)`, `publish_usage_update(...)`.
- Update `runtime_event_meta(event)` to merge the required `goose.messageId`, `goose.created`, and `goose.runtime` fields into the notification meta.
- Keep compatibility with update-level `_meta`: `metadata.ts` on frontend merges update `_meta` and notification `_meta`; backend must not rely on only one side for message identity. Put runtime identity in notification `_meta.goose`; also preserve update `_meta.goose` already used by tool identity.

Tests:

- Unit test `runtime_event_meta` with message id and tool id:
  - top-level `seq/kind/delivery/requestId` exist
  - `_meta.goose.messageId` exists
  - `_meta.goose.runtime.protocolVersion == 1`
  - `_meta.goose.runtime.eventId == "{session_id}:{seq}"`
  - existing `goose.toolCall` metadata survives if present

### 2. Pass Persisted Message Identity At Every Runtime Publish Site

Problem:

`on_prompt` has `stored_message_id = message.id.clone()`, but `handle_message_content` only passes that to tool persistence logic. Text/thinking/tool runtime events do not include it in runtime meta.

Required change in `crates/goose/src/acp/server.rs`:

- In `on_prompt`, for each `AgentEvent::Message(message)`:
  - Treat `message.id` as mandatory for replayable assistant runtime content.
  - Build `RuntimeEventIdentity { message_id: message.id.clone(), message_created: Some(message.created), tool_call_id: None }`.
  - Pass identity to `handle_message_content`.
- In `handle_message_content`:
  - For `MessageContent::Text`, publish `AgentMessageChunk` with identity containing `messageId`.
  - For `MessageContent::Thinking`, publish `AgentThoughtChunk` with the same `messageId`.
  - For `MessageContent::ToolRequest`, pass identity into `handle_tool_request`; set `tool_call_id = tool_request.id`.
  - For `MessageContent::ToolResponse`, pass identity into `handle_tool_response`; set `tool_call_id = tool_response.id`.
- In `handle_tool_request`, use the same `messageId` for:
  - initial `SessionUpdate::ToolCall`
  - async title summary `ToolCallUpdate`
- In `handle_tool_response`, use the same `messageId` for:
  - completion/failure `ToolCallUpdate`
  - async chain summary `ToolCallUpdate`
- For async tasks, clone the identity before spawning so late updates still carry the same `messageId`.
- If a tool summary task only knows `chain.message_id`, use that as `messageId`; this is already tracked by `ToolChain`.

Important:

- History replay already uses `replay_message_meta(message)` / `merge_replay_message_meta(meta, message)` to add `_meta.goose.messageId`.
- Runtime replay must use the same `message.id` value as history replay for the persisted assistant message.

Tests:

- Add unit tests around helper functions that build runtime meta from `Message`.
- Add or update server tests so runtime `AgentMessageChunk`, `ToolCall`, and `ToolCallUpdate` all carry `_meta.goose.messageId`.

### 3. Define Replay Ordering Contract

Problem:

`attach_existing_session_runtime` may send snapshot, runtime replay events, and history replay. Frontend needs deterministic rules.

Required backend behavior:

- On `load_session(lastSeq = 0)`:
  - Send runtime snapshot.
  - Send history replay for persisted messages.
  - Send runtime replay only for the active request tail that is not safely covered by history replay, and every runtime replay chat event must have `goose.messageId`.
- On `load_session(lastSeq > 0)`:
  - Send runtime snapshot.
  - Send runtime replay events with `seq > lastSeq`.
  - Do not send full history replay unless `replayTooOld` is true.
- If `replayTooOld` is true:
  - Notify with `_meta.replayTooOld = true` plus runtime snapshot.
  - Frontend will discard partial runtime assumptions and reload full history from scratch.

Required code audit:

- Current `on_load_session` calls `attach_existing_session_runtime(...)` before history replay.
- Current fresh runtime load filters replay events by active request id, then may skip history replay if runtime events exist. For exact merging, do not skip history replay solely because runtime events exist unless you can prove runtime replay fully covers the displayed transcript. Prefer sending history replay on fresh load and only active tail runtime replay after it.

Tests:

- Fresh attach with persisted history plus active runtime sends history message ids and active runtime message ids that match persisted ids where overlap exists.
- `lastSeq > 0` attach sends only events with `seq > lastSeq`.
- `replayTooOld` path is explicit and test-covered.

### 4. Always Clear `active_request` After `on_prompt` Errors

Problem:

`on_prompt` sets `session.active_request` and publishes `event_bus.set_active_request(Some(request_id))`. Later error paths return before cleanup:

- `agent.reply(...).await` failure
- stream item `Err(e)`
- `handle_message_content(...).await?` failure
- post-stream session/provider loading failures

Required change:

- Ensure cleanup runs on every exit after registering the request.
- Cleanup must clear `session.active_request`, clear `session.cancel_token`, update `last_activity_at`, and publish `event_bus.set_active_request(session_id, None)`.
- Only clear if stored request id matches.

Tests:

- Matching request id cleanup clears state and snapshot.
- Non-matching request id cleanup does not clear a newer request.
- If practical, simulate a failing prompt and assert a later prompt is not rejected as busy.

### 5. Make Prompt Completion Usage Replayable

Problem:

Prompt completion usage is sent directly with `cx.send_notification(SessionUpdate::UsageUpdate(...))`. If websocket is gone, reconnect cannot recover it.

Required change:

- Publish prompt completion `UsageUpdate` through `SessionEventBus` as replayable.
- Add explicit runtime kind `session.usage_update`.
- Usage update does not need `goose.messageId`; it is a session-level event. It still needs seq/kind/delivery/runtime eventId.
- Avoid duplicate delivery; prefer event bus only.

Tests:

- `UsageUpdate` replay appears in `replay_since(previous_seq)`.
- meta has `kind: "session.usage_update"` and runtime protocol metadata.

### 6. Deduplicate Runtime Event Subscribers Per Connection/Session

Problem:

`subscribe_session_events()` spawns a task on every call. Same websocket connection loading same session repeatedly can duplicate notifications.

Required change:

- Deduplicate by `(connection_id, session_id)`.
- `transport/websocket.rs` already has `connection_id`; wire it to ACP handler only as far as needed.
- Store subscription state in `GooseAcpSession` or connection-scoped registry.
- On websocket disconnect, remove client id from subscription tracking.

Tests:

- Same connection loading same session twice receives one notification per published runtime event.

## Acceptance Criteria

- Runtime replay chat events all carry stable `_meta.goose.messageId` matching history replay.
- Tool runtime events carry `_meta.goose.runtime.toolCallId`.
- Frontend never needs to infer a message target for protocol-compliant runtime replay.
- Fresh load and reconnect ordering rules are deterministic.
- Websocket disconnect does not stop backend runtime.
- Any `on_prompt` error path clears active request state.
- Prompt completion usage is recoverable through runtime replay.
- Repeated same-connection same-session load/attach does not duplicate notifications.
- `cargo fmt` is run.

## Verification

Run only if asked to build/test:

```bash
cargo fmt
cargo test -p goose session_events
cargo test -p goose acp
```

If server schema behavior changes:

```bash
just generate-openapi
```
