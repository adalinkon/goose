  目标

  把性能问题拆成两类处理：

  - 数据更新：减少 Zustand 更新次数、减少数组扫描、非当前 session 不实时物化完整 message tree。
  - 前端渲染：只有当前打开的 chat 才渲染，长聊天只渲染可视区域，未变化 message 不重渲染。

  阶段 1：通知入口解耦

  当前 acpConnection.ts 里 sessionUpdate 会 await notification handler。改成快速入队：

  - ACP callback 只 append 到 per-session notification queue。
  - 用 microtask / RAF / 30-50ms timer flush。
  - read loop 不被 chunk 处理阻塞。
  - 每个 session 单独排队，避免一个大 session 影响其他 session。

  目标：通知接收和 UI/store 更新解耦。

  阶段 2：流式文本 batch

  当前 agent text chunk 会频繁更新 messagesBySession[sessionId]。改成：

  - agent_message_chunk 先写入 pendingTextBySession。
  - active chat 每 30-50ms flush 一次。
  - flush 时只更新 streaming message。
  - stream end / session_info_update idle 时强制 flush。
  - stop / error / cancel 前强制 flush，避免丢最后一段文本。

  目标：chunk 很密时，从“每 chunk 一次 Zustand set”降到“每帧或每 30-50ms 一次 set”。

  阶段 3：message index

  给每个 session 建非响应式索引：

  type SessionMessageIndex = {
    messageIdToIndex: Map<string, number>;
    toolCallIdToLocation: Map<
      string,
      {
        messageId: string;
        messageIndex: number;
        contentIndex: number;
      }
    >;
  };

  维护点：

  - addMessage 写 messageIdToIndex
  - setMessages / replay flush 后重建 index
  - removeMessage / cleanup 后清 index
  - append tool request 时写 toolCallIdToLocation
  - 如果 message 数组结构大规模替换，重建当前 session index

  底层 store API：

  updateMessageByIndex(sessionId, messageIndex, updater)
  appendContentToMessageByIndex(sessionId, messageIndex, content)
  updateStreamingTextByIndex(sessionId, text)

  目标：避免 messages.map(...) 和反向扫描。

  阶段 4：tool 专用更新路径

  tool 不要只泛泛走 updateMessage，需要专门 API：

  appendToolRequest(sessionId, messageId, toolRequest)
  patchToolRequest(sessionId, toolCallId, patch)
  appendToolResponse(sessionId, toolCallId, toolResponse)

  对应 notification：

  - tool_call：ensure assistant message，然后 appendToolRequest
  - tool_call_update title/kind/locations/chainSummary：patchToolRequest
  - tool_call_update completed/failed：先 patchToolRequest(status)，再 appendToolResponse
  - late-arriving update：通过 toolCallIdToLocation 定位旧 message，不依赖 streaming message

  目标：tool 更新也走 O(1) 定位，不再扫描所有 messages 和 content。

  阶段 5：非 active session 延迟物化

  加 live buffer：

  type SessionLiveBuffer = {
    messageId: string | null;
    pendingText: string;
    pendingContent: MessageContent[];
    pendingToolUpdates: ToolUpdate[];
    activeRequestId: string | null;
    dirty: boolean;
  };

  规则：

  - active session 且 activeView 是 chat：按 batch flush 到 messagesBySession
  - 非 active session：只更新轻量状态，例如 chatState、hasUnread、activeRequestId、最后活动时间
  - 不实时更新完整 message tree
  - 用户切到该 session 时：先 drain buffer，再 mount ChatView
  - session complete / error 时：后台 buffer 保留最终状态，等打开再物化

  目标：后台 chat 收消息时不持续触发完整 UI 数据更新。

  阶段 6：缩小 Zustand 订阅面

  现在这些地方订阅了整个 messagesBySession：

  - AppShell
  - Sidebar
  - SessionHistoryView

  改成轻量派生状态：

  sessionMessageCountById: Record<string, number>
  startedSessionIds: Set<string>
  sessionActivityById: Record<string, { chatState; hasUnread; updatedAt }>

  用途：

  - sidebar 判断 session 是否显示：看 messageCount / startedSessionIds
  - unread/streaming 状态：看 session runtime
  - session history 不因每个 chunk 重算

  目标：某个 session streaming 时，不让 shell/sidebar/history 跟着全量重算。

  阶段 7：当前 ChatView 渲染优化

  保留现有结构，但减少无意义重算：

  - visibleMessages = useMemo(...)
  - resolvedScrollTargetMessageId 依赖 memo 后的 visibleMessages
  - shouldOverlapComposerWithLatestMcpApp 改成基于 latest visible message signature，而不是每次扫整个 messages
  - ArtifactPolicyProvider 如果只需要 artifact cwd 和 artifact block，可考虑传更小的 derived data
  - 保证 message 对象引用稳定：没更新的 message 不换引用

  回答你前面那个问题：没更新的 message 是否会重新渲染，取决于引用是否变。MessageBubble 已经 memo，如果旧 message 对象引用不
  变，它不会真正重渲染；但 timeline 父组件仍会重新执行 map。所以数据层必须只替换变化的 message。

  阶段 8：虚拟列表

  虚拟列表放进这一版，但在 batch/index 后做，接入点是 MessageTimeline.tsx。

  建议新增：

  pnpm add @tanstack/react-virtual

  使用方式：

  const rowVirtualizer = useVirtualizer({
    count: visibleMessages.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => 96,
    overscan: 8,
    getItemKey: (index) => visibleMessages[index].id,
  });

  渲染只渲染：

  rowVirtualizer.getVirtualItems()

  动态高度处理：

  - 每个 row 使用 rowVirtualizer.measureElement
  - Markdown、tool card、MCP app、图片都允许动态高度
  - streaming message 增长后重新 measure

  滚动策略：

  - near bottom 时用 scrollToIndex(lastIndex, { align: "end" })
  - 用户向上滚后不抢滚动
  - stream flush 后，如果 sticky bottom active，再滚到底
  - MCP app 出现或高度变化时，如果 near bottom，measure 后滚到底

  搜索/跳转：

  - 不能依赖 messageRefs[id].scrollIntoView()，因为目标可能未挂载
  - 先找 targetIndex
  - rowVirtualizer.scrollToIndex(targetIndex, { align: "center" })
  - 下一帧 row mount 后再 pulsing highlight

  目标：1000 条消息只挂载 viewport + overscan 的 row。

  阶段 9：验证指标

  最小验证：

  - active streaming：chunk 很密时 UI 不卡，文本不丢。
  - inactive streaming：sidebar 只显示 unread/streaming，不重渲染完整 ChatView。
  - 切回 inactive session：buffer 正确物化，消息顺序正确。
  - tool_call / tool_call_update / toolResponse 都落在正确 message。
  - late tool update 不错误追加到当前 streaming message。
  - 1000 条消息 session，DOM row 数量接近可视区域 + overscan。
  - 搜索跳转能跳到未挂载历史消息。
  - 用户向上滚时 streaming 不抢滚动；在底部时持续跟随。

  推荐落地顺序

  1. notification queue，不阻塞 read loop。
  2. streaming text batch flush。
  3. message index + indexed update。
  4. tool 专用 indexed update。
  5. inactive session buffer + 切回 drain。
  6. sidebar/app/history 轻量 selector。
  7. MessageTimeline memo 和 latest signature 优化。
  8. 虚拟列表。
  9. 补 tests 和 perf log。

  这版的核心原则是：后台只收数据和维护轻量状态；当前 chat 才物化 message tree；当前 chat 里也只渲染屏幕附近的 message。




----version2
  # Goose2web Chat Runtime / UI Performance Refactor Plan

  ## Background

  goose2web recently changed backend session runtime so it is no longer tied to a single WebSocket connection. After that,
  frontend refresh has two correctness bugs:

  1. Refreshing a chat window can leave only one message visible.
  2. If refresh happens while the backend is responding, the UI keeps receiving message updates but does not show responding
  state and the stop button is disabled.

  At the same time, chat UI has performance issues:

  - Frequent streaming chunks update Zustand `messagesBySession` too often.
  - Tool updates scan message arrays.
  - Sidebar/history subscribe to full `messagesBySession`.
  - Inactive sessions may still cause expensive data updates.
  - Long chats render all messages.

  We need one coherent architecture, not patches.

  ## Current Key Files

  - `src/shared/api/acpConnection.ts`
    - ACP client callbacks.
    - Currently calls notification handler directly.

  - `src/shared/api/acpNotificationHandler.ts`
    - Currently parses notifications and mutates `useChatStore` directly.

  - `src/shared/api/acp.ts`
    - `acpLoadSession`, `acpCancelSession`.

  - `src/shared/api/acpApi.ts`
    - low-level ACP wrappers including `loadSession`.

  - `src/app/AppShell.tsx`
    - currently owns `loadSessionMessages`.
    - currently skips loading when `messagesBySession[sessionId].length > 0`.

  - `src/features/chat/stores/chatStore.ts`
    - stores `messagesBySession`, `sessionStateById`, loading ids, drafts, etc.

  - `src/features/chat/ui/ChatView.tsx`
    - active chat surface.

  - `src/features/chat/ui/MessageTimeline.tsx`
    - renders all visible messages.

  - `src/features/chat/ui/MessageBubble.tsx`
    - already wrapped in `memo`.

  ## Important Existing Bug

  Do not keep this logic:

  ```ts
  const existingMsgs = useChatStore.getState().messagesBySession[sessionId];
  if ((existingMsgs?.length ?? 0) > 0) return;

  After refresh, live chunks can arrive before history load finishes. That creates one assistant message locally; then load is
  skipped because messages.length > 0, leaving only that one message.

  History loaded state must be explicit, not inferred from message count.

  ## High-Level Architecture

  Create a dedicated runtime layer:

  ACP transport
    ↓
  SessionRuntimeCoordinator
    ↓
  notification classifier + hydrator + reducer + buffers + indexes
    ↓
  chatStore presentation cache
    ↓
  ChatView / MessageTimeline

  acpNotificationHandler.ts should stop directly mutating chatStore.messagesBySession.

  It should only forward notifications:

  sessionRuntimeCoordinator.enqueueNotification(notification);

  AppShell should stop owning session load/replay details.

  It should call:

  sessionRuntimeCoordinator.activateSession(sessionId);
  sessionRuntimeCoordinator.ensureSessionLoaded(sessionId);

  ## Proposed New Folder

  Create:

  src/features/chat/runtime/
    types.ts
    notificationClassifier.ts
    sessionRuntimeCoordinator.ts
    sessionHydrator.ts
    sessionEventReducer.ts
    sessionBuffers.ts
    sessionIndexes.ts
    flushScheduler.ts
    selectors.ts

  ## Module Responsibilities

  ### types.ts

  Define shared runtime types.

  Suggested shapes:

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

  Also define normalized events:

  export type ChatRuntimeEvent =
    | { type: "agentText"; sessionId: string; messageId?: string; text: string; seq?: number }
    | { type: "toolRequest"; sessionId: string; messageId?: string; tool: ToolRequestContent; seq?: number }
    | { type: "toolPatch"; sessionId: string; toolCallId: string; patch: Partial<ToolRequestContent>; seq?: number }
    | { type: "toolResponse"; sessionId: string; toolCallId: string; response: ToolResponseContent; seq?: number }
    | { type: "runtimeSnapshot"; sessionId: string; activeRequestId: string | null; lastSeq: number };

  ### notificationClassifier.ts

  Classify ACP notifications using _meta.

  Rules:

  - If notification/update meta contains runtime, classify as runtime-snapshot.
  - If notification meta contains runtime event fields such as seq, kind, or delivery, classify as runtime-replay or live.
  - If session phase is hydrating and no runtime meta exists, classify as history-replay.
  - Otherwise classify as live.

  Do not rely only on loadingSessionIds.has(sessionId).

  ### sessionHydrator.ts

  Own session loading.

  Responsibilities:

  - Start hydration.
  - Call acpLoadSession.
  - Read LoadSessionResponse._meta.runtime.
  - Apply runtime snapshot.
  - Flush history buffer.
  - Apply live/runtime buffer.
  - Mark phase as ready or attached-runtime.

  Important: change acpLoadSession in src/shared/api/acp.ts to return LoadSessionResponse instead of void.

  Also pass lastSeq when available. Backend supports lastSeq in request meta, so eventually acpApi.loadSession should send:

  _meta: { lastSeq }

  ### sessionRuntimeCoordinator.ts

  This is the main public API.

  Suggested methods:

  activateSession(sessionId: string): void;
  deactivateSession(sessionId: string): void;
  ensureSessionLoaded(sessionId: string): Promise<void>;
  enqueueNotification(notification: SessionNotification): void;
  flushSession(sessionId: string): void;
  flushAll(): void;

  Responsibilities:

  - Own active session id / visible session state.
  - Route notifications to classifier.
  - Send events to history buffer, live buffer, or reducer.
  - Decide active vs inactive materialization.
  - Schedule batch flush.
  - Force flush on stream end, cancel, error, and hydration finish.

  ### sessionEventReducer.ts

  Convert ACP SessionUpdate into normalized ChatRuntimeEvent or message patches.

  This should be the only place with logic for:

  - agent_message_chunk
  - tool_call
  - tool_call_update
  - session_info_update
  - usage_update
  - config updates if needed

  Tool logic must not remain scattered in notification handler.

  ### sessionBuffers.ts

  Maintain non-React buffers:

  - historyReplayBuffer
  - liveBuffer
  - pending streaming text
  - pending tool updates
  - processed runtime seq ids

  Suggested model:

  type SessionLiveBuffer = {
    messageId: string | null;
    pendingText: string;
    pendingContent: MessageContent[];
    pendingToolUpdates: ToolUpdate[];
    dirty: boolean;
  };

  Rules:

  - During hydration:
      - history replay -> history buffer
      - runtime replay/live events -> live buffer
  - Finish hydration:
      - materialize history
      - apply live buffer in seq/order
  - Active session:
      - flush live buffer every 30-50ms
  - Inactive session:
      - keep live buffer
      - update only lightweight runtime/unread/count state

  ### sessionIndexes.ts

  Maintain message indexes outside React state.

  type SessionMessageIndex = {
    messageIdToIndex: Map<string, number>;
    toolCallIdToLocation: Map<
      string,
      {
        messageId: string;
        messageIndex: number;
        contentIndex: number;
      }
    >;
  };

  Maintain on:

  - setMessages
  - appendMessage
  - removeMessage
  - cleanupSession
  - append tool request

  ### flushScheduler.ts

  Batch UI writes.

  Rules:

  - active session flush interval: 30-50ms or requestAnimationFrame.
  - stream end / runtime activeRequestId becomes null: force flush.
  - stop/cancel/error: force flush.
  - hydration finish: force flush.
  - inactive sessions do not flush full messages unless activated.

  ### selectors.ts

  Provide lightweight selectors:

  - active session messages
  - session runtime view
  - sidebar presentation data
  - session history presentation data

  Sidebar/history should not subscribe to full messagesBySession.

  ## chatStore Changes

  Keep chatStore as presentation cache, not protocol brain.

  Add explicit runtime/hydration state:

  sessionRuntimeViewById: Record<string, SessionRuntimeView>;
  sessionMessageCountById: Record<string, number>;
  startedSessionIds: Set<string>;

  Add indexed actions:

  setMessages(sessionId, messages)
  appendMessage(sessionId, message)
  appendContentByMessageId(sessionId, messageId, content)
  appendTextByMessageId(sessionId, messageId, text)
  patchToolRequest(sessionId, toolCallId, patch)
  appendToolResponse(sessionId, toolCallId, response)
  setRuntimeView(sessionId, runtimeView)

  Internally these should use sessionIndexes.ts to avoid scanning arrays.

  ## Tool Update Design

  Tool updates need first-class APIs.

  Do not just call generic updateMessage.

  Use:

  appendToolRequest(sessionId, messageId, toolRequest)
  patchToolRequest(sessionId, toolCallId, patch)
  appendToolResponse(sessionId, toolCallId, toolResponse)

  Behavior:

  - tool_call appends toolRequest and records toolCallIdToLocation.
  - tool_call_update patches title/status/kind/locations/chainSummary by toolCallId.
  - completed/failed patches status and appends toolResponse.
  - late-arriving tool updates must locate the original message through toolCallIdToLocation, not through current
    streamingMessageId.

  ## Active vs Inactive Sessions

  Active condition:

  activeView === "chat" && activeSessionId === sessionId

  Active session:

  - materialize live buffer to messagesBySession
  - batch streaming text every 30-50ms
  - update visible timeline

  Inactive session:

  - do not update full message tree on every chunk
  - update only:
      - activeRequestId
      - isResponding
      - hasUnread
      - lastSeq
      - sessionMessageCountById
  - keep live content in buffer
  - materialize when user opens the session

  ## Refresh Recovery Requirements

  On refresh during responding:

  1. ensureSessionLoaded(sessionId) calls loadSession.
  2. If backend attaches existing runtime, read response _meta.runtime.
  3. If activeRequestId exists:
      - set isResponding = true
      - set chat state to streaming/responding
      - enable stop button
  4. Runtime replay/live updates continue to append text/tool output.
  5. Historical messages are preserved and merged before live buffer materialization.

  Do not infer responding state from whether chunks arrive. Use runtime snapshot.

  ## UI Rendering Optimization

  ### ChatView

  ChatView should subscribe only to:

  messagesBySession[sessionId]
  sessionRuntimeViewById[sessionId]

  No global messagesBySession subscription.

  ### Sidebar / History

  Replace full messagesBySession subscriptions with lightweight derived data:

  sessionMessageCountById
  startedSessionIds
  sessionRuntimeViewById
  sessionStateById

  ### MessageTimeline

  Before virtual list:

  - memoize visibleMessages
  - preserve message object identity for unchanged messages
  - avoid scanning full message list for composer overlap; derive latest visible message signature

  MessageBubble is already memo. It only helps if unchanged message objects keep the same reference.

  ## Virtual List Plan

  Add @tanstack/react-virtual.

  Integrate in MessageTimeline.tsx.

  const rowVirtualizer = useVirtualizer({
    count: visibleMessages.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => 96,
    overscan: 8,
    getItemKey: (index) => visibleMessages[index].id,
  });

  Requirements:

  - Render only rowVirtualizer.getVirtualItems().
  - Use measureElement for dynamic row heights.
  - Support Markdown, tool cards, MCP apps, images.
  - Streaming message growth should re-measure.
  - Near-bottom auto-scroll should use scrollToIndex(lastIndex, { align: "end" }).
  - If user scrolled up, do not force scroll.
  - Search/jump should use target index, not DOM ref that may not be mounted.
  - MCP app appearance/height changes should measure and scroll only if sticky bottom is active.

  ## Recommended Implementation Order

  1. Create runtime/ module skeleton and types.
  2. Move notification entry to SessionRuntimeCoordinator.enqueueNotification.
  3. Move loadSessionMessages from AppShell into sessionHydrator.
  4. Change load skip logic to explicit hydration phase.
  5. Make acpLoadSession return response and apply _meta.runtime.
  6. Add lastSeq tracking and pass _meta.lastSeq.
  7. Add notification classification.
  8. Add history/live buffers and hydration merge.
  9. Add active/inactive materialization rules.
  10. Add batch flush scheduler.
  11. Add message indexes.
  12. Add tool indexed APIs.
  13. Replace Sidebar/History/AppShell full messagesBySession subscriptions.
  14. Add MessageTimeline memo optimizations.
  15. Add virtual list.

  ## Verification

  Correctness:

  - Refresh while idle: full history appears.
  - Refresh while responding: full history appears, responding state shows, stop button works.
  - Live chunk arriving before load finishes does not create a one-message-only session.
  - Runtime replay events are not duplicated.
  - Late tool updates attach to correct old message.
  - Stream completion clears responding state and marks message completed.
  - Cancel after refresh stops the active backend request.

  Performance:

  - Streaming text does not update Zustand per chunk.
  - Active session flushes every 30-50ms or frame.
  - Inactive session streaming does not update full message tree.
  - Sidebar/history do not rerender on every chunk.
  - Tool updates do not scan all messages.
  - 1000-message chat only mounts viewport + overscan rows.
  - Search jump, auto-scroll, and MCP app sticky scroll still work.