# Runtime Subscription / Global Event Bus Improve Plan v1

This document is for an agent with no prior conversation context. It describes the next structural improvement after the runtime replay protocol fix.

The target is to separate authoritative session list loading, global lightweight session deltas, and per-session full runtime streams.

Do not solve this by broadcasting every session's full messages to every websocket. Do not solve this by letting the frontend ignore unwanted messages after the backend has already sent them. Add clean backend ownership for subscription scope.

## Current Problem

The current runtime model has these issues:

- `listSessions` returns a static list. It is not a realtime session index.
- `loadSession` currently mixes history loading and runtime subscription.
- Once a frontend opens a session, the backend subscribes that connection to that session's runtime events.
- Switching from session A to session B does not explicitly cancel A's runtime subscription on the same websocket connection.
- A client does not know about sessions created by another client unless it refreshes the session list.
- Background session state and foreground message streams are not separated.

Desired behavior:

```text
"frontend connects"
-> "frontend calls listSessions for the authoritative session list"
-> "frontend renders the session list"
-> "frontend receives GlobalEventBus deltas after that"
```

```text
"any client creates or updates a session"
-> "backend broadcasts a lightweight session index event to all connected clients"
-> "all frontends update sidebars/status"
```

```text
"user opens session A"
-> "frontend attaches session A runtime"
-> "backend sends A history/replay/live runtime only to that connection"
```

```text
"user switches from A to B"
-> "frontend detaches A runtime"
-> "frontend attaches B runtime"
-> "backend stops sending A full runtime events to that connection"
```

## Backend Design

### 1. Add `GlobalEventBus`

Add one server-wide global bus for lightweight global events.

Name:

```rust
GlobalEventBus
GlobalEvent
```

Purpose:

- Broadcast low-frequency, lightweight global/domain events to connected clients.
- First supported domain is session index.
- Future domains can include provider inventory, config, auth, system status, etc.
- It must not carry per-session runtime message streams.
- It must not be the authoritative source for full session lists.

Do not put authoritative state inside the bus. The bus only broadcasts events. Authoritative state remains in `SessionManager`, the runtime session map, and dedicated domain services.

Suggested event shape:

```rust
pub enum GlobalEvent {
    SessionIndex(SessionIndexEvent),
}
```

### 2. Add Session Index Events

Add typed session index events under `GlobalEvent::SessionIndex`.

Suggested shape:

```rust
pub enum SessionIndexEvent {
    Added {
        revision: u64,
        session: SessionIndexEntry,
    },
    Updated {
        revision: u64,
        session: SessionIndexEntry,
    },
    Removed {
        revision: u64,
        session_id: String,
    },
    Activity {
        revision: u64,
        session_id: String,
        runtime: SessionRuntimeIndexState,
        updated_at: String,
    },
}
```

Suggested session entry:

```rust
pub struct SessionIndexEntry {
    pub session_id: String,
    pub title: Option<String>,
    pub working_dir: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    pub message_count: usize,
    pub provider_id: Option<String>,
    pub model_id: Option<String>,
    pub runtime: SessionRuntimeIndexState,
}

pub struct SessionRuntimeIndexState {
    pub is_running: bool,
    pub active_request_id: Option<String>,
    pub last_seq: Option<u64>,
}
```

Rules:

- `listSessions` is the authority for the full list.
- `GlobalEventBus` only sends incremental session index changes.
- Delta events must carry monotonically increasing `revision`.
- Frontend ignores deltas older than or equal to its current session index revision.
- If the frontend suspects missed deltas, or after reconnect, it calls `listSessions` again.
- Session index events must not include messages, token chunks, tool call details, or transcript content.

### 3. Add A Session Index Service

Add a service or helper responsible for building session summaries and publishing session index events through `GlobalEventBus`.

Suggested name:

```rust
SessionIndexService
```

Responsibilities:

- Build `SessionIndexEntry` values from persisted sessions plus runtime session state.
- Build a `SessionIndexEntry` for one session.
- Publish `Added`, `Updated`, `Removed`, and `Activity`.
- Maintain the session index `revision`.

Do not scatter raw `GlobalEventBus.publish(...)` calls throughout unrelated code. Prefer local domain methods:

```rust
self.session_index.session_added(...).await;
self.session_index.session_updated(...).await;
self.session_index.session_removed(...).await;
self.session_index.runtime_activity_changed(...).await;
```

### 4. Connect Global Events To ACP Clients

On ACP initialize for a websocket connection:

```text
"client initialize"
-> "backend declares global event/session index capability in _meta"
-> "backend subscribes that connection to GlobalEventBus deltas"
-> "frontend separately calls listSessions for the authoritative full list"
```

Use ACP notifications with a clear Goose-specific method or metadata shape. Keep the protocol typed and documented. Avoid arbitrary unstructured JSON blobs.

The websocket disconnect cleanup must cancel:

- The connection's global event subscription task.
- All runtime session subscription tasks for that connection.
- Existing `attached_clients` connection membership.

### 5. Split Runtime Attach/Detach Semantics

Current `loadSession` implicitly subscribes the current connection to session runtime events. Replace that implicit long-lived behavior with explicit runtime subscription semantics.

Target operations:

```text
attachSessionRuntime(sessionId, lastSeq)
detachSessionRuntime(sessionId)
```

Attach behavior:

```text
"attachSessionRuntime(sessionId, lastSeq)"
-> "backend sends runtime snapshot"
-> "backend replays events with seq > lastSeq"
-> "backend subscribes this connection to live runtime events for that session"
```

Detach behavior:

```text
"detachSessionRuntime(sessionId)"
-> "backend cancels this connection's subscription to that session"
-> "session keeps running"
-> "SessionEventBus continues retaining replayable runtime events"
```

Backend must save cancellable runtime subscriptions by connection and session:

```text
(connection_id, session_id) -> subscription task or cancellation token
connection_id -> subscribed session ids
```

Calling attach twice for the same `(connection_id, session_id)` must not create duplicate live subscriptions.

### 6. Keep `SessionEventBus` For Per-Session Runtime

Keep the existing `SessionEventBus` role:

- One per active runtime session.
- Owns runtime `seq`.
- Owns replay buffer.
- Owns runtime snapshot.
- Publishes full runtime events such as `agent_message_chunk`, `tool_call`, `tool_call_update`, `usage_update`.

Do not move full runtime messages into `GlobalEventBus`.

`SessionEventBus` may notify `SessionIndexService` when runtime activity changes:

```text
"active_request_id becomes Some"
-> "publish session_index.activity isRunning=true"
```

```text
"active_request_id becomes None"
-> "publish session_index.activity isRunning=false"
```

## Frontend Design

### 1. Add Global Event Handling

Add a global event notification handler that parses `GlobalEvent::SessionIndex`.

Frontend state should keep:

```ts
sessionIndexRevision: number
sessions: ChatSession[]
runtimeSummaryBySessionId: Record<string, SessionRuntimeIndexState>
```

Apply rules:

- `added`: insert session if revision is newer.
- `updated`: replace session summary if revision is newer.
- `removed`: remove session if revision is newer.
- `activity`: update lightweight runtime status only.

### 2. Keep `listSessions` As The Authoritative Full List

`listSessions` remains the authoritative way to fetch the current full session list.

Use it for:

- startup
- manual refresh
- reconnect recovery
- pagination/search if needed
- recovery after suspected missed deltas

Startup target:

```text
"frontend initialize ACP"
-> "subscribe to GlobalEventBus deltas"
-> "call listSessions"
-> "hydrate sidebar/session store from listSessions response"
```

`GlobalEventBus` is the realtime delta path. It should reduce refresh pressure, not replace the full-list API.

### 3. Attach Only The Open Session Runtime

When the user opens a chat:

```text
"open session A"
-> "attachSessionRuntime(A, lastSeq)"
-> "render A history/replay/live events"
```

When the user switches:

```text
"switch A -> B"
-> "detachSessionRuntime(A)"
-> "attachSessionRuntime(B, lastSeq)"
```

Only the currently opened chat session should receive the full runtime stream by default.

Background sessions still update via session index `activity` events, not full chat runtime events.

### 4. Simplify Reconnect Recovery

On websocket reconnect:

```text
"new ACP connection initialized"
-> "subscribe to GlobalEventBus deltas"
-> "call listSessions"
-> "replace/merge session list from authoritative response"
-> "attach only the currently opened session with its lastSeq"
```

Do not reattach every session that was ever opened in the old websocket lifetime.

Rename reconnect-related frontend concepts to connection-ready/attach terms where code still says reconnect for initial connection:

```text
onAcpConnectionReconnected -> onAcpConnectionReady
reconnectListeners -> connectionReadyListeners
reattachActiveSessions -> attachActiveSessionsToCurrentConnection
attachedGenerationBySession -> sessionAttachedGeneration
ensureSessionLoaded -> ensureSessionAttached
```

Keep:

```text
getAcpConnectionGeneration
```

The generation is the frontend-local ACP connection epoch. It lets the frontend know whether a session runtime is attached to the current ACP connection or only to a previous dead connection.

## End-To-End Flows

### Initial Connection

```text
"frontend ACP url/auth ready, starts connection"
-> "frontend sends initialize"
-> "backend initialize completes and declares global event/session index capability"
-> "frontend calls listSessions"
-> "backend returns all visible session summaries"
-> "frontend renders session list"
-> "frontend attaches currently routed/open session only, if any"
```

### Session Created By Another Client

```text
"client B creates session X"
-> "backend creates X"
-> "SessionIndexService publishes session_index.added"
-> "GlobalEventBus broadcasts to all connected clients"
-> "client A sees X in sidebar"
-> "client A does not receive X full runtime stream unless user opens X"
```

### Open Session

```text
"user clicks session A"
-> "frontend calls attachSessionRuntime(A, lastSeq)"
-> "backend sends runtime snapshot"
-> "backend replays events after lastSeq"
-> "backend subscribes this connection to A live runtime"
```

### Switch Session

```text
"user switches from A to B"
-> "frontend calls detachSessionRuntime(A)"
-> "backend cancels A live runtime subscription for this connection"
-> "frontend calls attachSessionRuntime(B, lastSeq)"
-> "backend sends B replay/live runtime"
```

### Background Runtime Activity

```text
"session A continues running after current frontend detached A runtime"
-> "SessionEventBus keeps A replay buffer"
-> "SessionIndexService publishes session_index.activity"
-> "frontend updates A sidebar running/updated state"
-> "full A chunks are not sent to detached frontend"
```

### Reconnect

```text
"websocket closes"
-> "backend removes connection and cancels global/runtime subscriptions"
-> "frontend keeps local session index and lastSeq values"
```

```text
"websocket reconnects"
-> "frontend initialize"
-> "frontend calls listSessions"
-> "frontend applies authoritative session list response"
-> "frontend attaches only current open session with lastSeq"
```

## Implementation Notes

### Backend Files To Inspect

- `crates/goose/src/acp/session_events.rs`
- `crates/goose/src/acp/server.rs`
- `crates/goose/src/acp/server/dispatch.rs`
- `crates/goose/src/acp/server_factory.rs`
- `crates/goose/src/acp/transport/connection.rs`
- `crates/goose/src/acp/transport/websocket.rs`

Useful searches:

```bash
rg -n "SessionEventBus|subscribe_session_events|attached_clients|detach_client|on_load_session|on_new_session|on_close_session|active_request|set_active_request" crates/goose/src/acp
rg -n "broadcast::|JoinHandle|CancellationToken|ConnectionRegistry|connection_id|SessionNotification" crates/goose/src/acp
```

### Frontend Files To Inspect

- `ui/goose2web/src/shared/api/acpConnection.ts`
- `ui/goose2web/src/shared/api/acpNotificationHandler.ts`
- `ui/goose2web/src/shared/api/acpApi.ts`
- `ui/goose2web/src/features/chat/runtime/sessionRuntimeCoordinator.ts`
- `ui/goose2web/src/features/chat/runtime/sessionHydrator.ts`
- `ui/goose2web/src/features/chat/stores/chatSessionStore.ts`
- `ui/goose2web/src/app/AppShell.tsx`

Useful searches:

```bash
rg -n "listSessions|loadSession|ensureSessionLoaded|onAcpConnectionReconnected|reattachActiveSessions|attachedGenerationBySession|activeSessionId|sessionRuntimeCoordinator" ui/goose2web/src
```

## Tests

### Backend Tests

Cover:

- New connection can subscribe to GlobalEventBus deltas.
- Creating a session from one connection broadcasts `session_index.added` to other connections.
- Updating title/metadata broadcasts `session_index.updated`.
- Starting and ending a request broadcasts `session_index.activity`.
- Closing a session broadcasts `session_index.removed`.
- Attaching a runtime twice for the same connection/session does not duplicate live events.
- Detaching runtime stops live runtime delivery for that connection.
- Detached connection can reattach with `lastSeq` and receive replayed events.
- Websocket disconnect cancels all global and runtime subscription tasks for that connection.

### Frontend Tests

Cover:

- Startup calls `listSessions` and populates session store.
- Added/updated/removed/activity deltas apply only when revision is newer.
- Opening a session calls runtime attach.
- Switching sessions calls detach for old session and attach for new session.
- Reconnect calls `listSessions` and attaches only the current open session.
- Background session activity updates sidebar state without applying full chat runtime messages.

## Non-Goals

- Do not broadcast full runtime messages to all websocket clients.
- Do not subscribe every client to every session runtime by default.
- Do not rely on frontend filtering as a substitute for backend detach.
- Do not move per-session `seq` and replay buffer into `GlobalEventBus`.
- Do not make `GlobalEventBus` an untyped JSON dumping ground.
- Do not make `GlobalEventBus` responsible for full-list snapshot state.

## Acceptance Criteria

- All connected clients learn about newly created sessions through global session index events.
- Only the currently attached/open session sends full runtime messages to a frontend connection.
- Switching sessions cancels the old session's backend runtime subscription for that connection.
- Reconnecting restores the session list through `listSessions` and runtime from `lastSeq`.
- `GlobalEventBus` carries only typed lightweight global events.
- `SessionEventBus` remains the only owner of per-session full runtime replay.
