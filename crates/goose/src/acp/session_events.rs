use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};

use agent_client_protocol::schema::{Meta, SessionInfoUpdate, SessionUpdate};
use tokio::sync::{broadcast, Mutex, RwLock};

const SESSION_EVENT_BUFFER_CAPACITY: usize = 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RuntimeEventDelivery {
    Replay,
    Snapshot,
}

impl RuntimeEventDelivery {
    fn as_str(self) -> &'static str {
        match self {
            Self::Replay => "replay",
            Self::Snapshot => "snapshot",
        }
    }
}

#[derive(Debug, Clone)]
pub struct RuntimeEvent {
    pub seq: u64,
    pub session_id: String,
    pub kind: String,
    delivery: RuntimeEventDelivery,
    created_at: chrono::DateTime<chrono::Utc>,
    pub request_id: Option<String>,
    pub update: SessionUpdate,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionRuntimeSnapshot {
    pub session_id: String,
    pub alive: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_request_id: Option<String>,
    pub last_seq: u64,
}

pub struct SessionEventBus {
    next_seq: AtomicU64,
    tx: broadcast::Sender<RuntimeEvent>,
    buffer: Mutex<VecDeque<RuntimeEvent>>,
    snapshot: RwLock<SessionRuntimeSnapshot>,
}

impl SessionEventBus {
    pub fn new(session_id: String) -> Self {
        let (tx, _) = broadcast::channel(SESSION_EVENT_BUFFER_CAPACITY);
        Self {
            next_seq: AtomicU64::new(1),
            tx,
            buffer: Mutex::new(VecDeque::new()),
            snapshot: RwLock::new(SessionRuntimeSnapshot {
                session_id,
                alive: true,
                active_request_id: None,
                last_seq: 0,
            }),
        }
    }

    pub async fn publish_chat_update(
        &self,
        session_id: &str,
        request_id: Option<String>,
        update: SessionUpdate,
    ) -> RuntimeEvent {
        self.publish(
            session_id,
            runtime_event_kind(&update),
            RuntimeEventDelivery::Replay,
            request_id,
            update,
        )
        .await
    }

    pub async fn publish_tool_call_update(
        &self,
        session_id: &str,
        request_id: Option<String>,
        update: SessionUpdate,
    ) -> RuntimeEvent {
        self.publish(
            session_id,
            RuntimeEventKind::ChatToolCallUpdate,
            RuntimeEventDelivery::Replay,
            request_id,
            update,
        )
        .await
    }

    async fn publish(
        &self,
        session_id: &str,
        kind: RuntimeEventKind,
        delivery: RuntimeEventDelivery,
        request_id: Option<String>,
        update: SessionUpdate,
    ) -> RuntimeEvent {
        let seq = self.next_seq.fetch_add(1, Ordering::SeqCst);
        let event = RuntimeEvent {
            seq,
            session_id: session_id.to_string(),
            kind: runtime_event_kind_name(kind),
            delivery,
            created_at: chrono::Utc::now(),
            request_id,
            update,
        };

        if delivery == RuntimeEventDelivery::Replay {
            let mut buffer = self.buffer.lock().await;
            if buffer.len() >= SESSION_EVENT_BUFFER_CAPACITY {
                buffer.pop_front();
            }
            buffer.push_back(event.clone());
        }

        {
            let mut snapshot = self.snapshot.write().await;
            snapshot.last_seq = seq;
        }

        let _ = self.tx.send(event.clone());
        event
    }

    pub async fn set_active_request(&self, session_id: &str, active_request_id: Option<String>) {
        let seq = self.next_seq.fetch_add(1, Ordering::SeqCst);
        let snapshot = {
            let mut snapshot = self.snapshot.write().await;
            snapshot.alive = true;
            snapshot.active_request_id = active_request_id.clone();
            snapshot.last_seq = seq;
            snapshot.clone()
        };

        let event = RuntimeEvent {
            seq,
            session_id: session_id.to_string(),
            kind: runtime_event_kind_name(RuntimeEventKind::SessionRuntimeState),
            delivery: RuntimeEventDelivery::Snapshot,
            created_at: chrono::Utc::now(),
            request_id: active_request_id,
            update: SessionUpdate::SessionInfoUpdate(
                SessionInfoUpdate::new().meta(session_runtime_state_meta(&snapshot)),
            ),
        };
        let _ = self.tx.send(event);
    }

    pub async fn replay_since(&self, last_seq: Option<u64>) -> (Vec<RuntimeEvent>, bool) {
        let buffer = self.buffer.lock().await;
        let Some(last_seq) = last_seq else {
            return (buffer.iter().cloned().collect(), false);
        };
        let Some(first) = buffer.front() else {
            return (Vec::new(), false);
        };
        if last_seq < first.seq.saturating_sub(1) {
            return (Vec::new(), true);
        }

        (
            buffer
                .iter()
                .filter(|event| event.seq > last_seq)
                .cloned()
                .collect(),
            false,
        )
    }

    pub async fn snapshot(&self) -> SessionRuntimeSnapshot {
        self.snapshot.read().await.clone()
    }

    pub fn subscribe(&self) -> broadcast::Receiver<RuntimeEvent> {
        self.tx.subscribe()
    }
}

enum RuntimeEventKind {
    ChatAgentChunk,
    ChatThoughtChunk,
    ChatToolCall,
    ChatToolCallUpdate,
    SessionRuntimeState,
}

fn runtime_event_kind(update: &SessionUpdate) -> RuntimeEventKind {
    match update {
        SessionUpdate::AgentMessageChunk(_) => RuntimeEventKind::ChatAgentChunk,
        SessionUpdate::AgentThoughtChunk(_) => RuntimeEventKind::ChatThoughtChunk,
        SessionUpdate::ToolCall(_) => RuntimeEventKind::ChatToolCall,
        SessionUpdate::ToolCallUpdate(_) => RuntimeEventKind::ChatToolCallUpdate,
        _ => RuntimeEventKind::ChatAgentChunk,
    }
}

fn runtime_event_kind_name(kind: RuntimeEventKind) -> String {
    match kind {
        RuntimeEventKind::ChatAgentChunk => "chat.agent_chunk",
        RuntimeEventKind::ChatThoughtChunk => "chat.thought_chunk",
        RuntimeEventKind::ChatToolCall => "chat.tool_call",
        RuntimeEventKind::ChatToolCallUpdate => "chat.tool_call_update",
        RuntimeEventKind::SessionRuntimeState => "session.runtime_state",
    }
    .to_string()
}

pub fn session_runtime_state_meta(snapshot: &SessionRuntimeSnapshot) -> Meta {
    let mut meta = serde_json::Map::new();
    meta.insert(
        "runtime".to_string(),
        serde_json::to_value(snapshot).unwrap_or(serde_json::Value::Null),
    );
    meta
}

pub fn runtime_event_meta(event: &RuntimeEvent) -> Meta {
    let mut meta = serde_json::Map::new();
    meta.insert("seq".to_string(), event.seq.into());
    meta.insert(
        "sessionId".to_string(),
        serde_json::Value::String(event.session_id.clone()),
    );
    meta.insert(
        "kind".to_string(),
        serde_json::Value::String(event.kind.clone()),
    );
    meta.insert(
        "delivery".to_string(),
        serde_json::Value::String(event.delivery.as_str().to_string()),
    );
    meta.insert(
        "createdAt".to_string(),
        serde_json::Value::String(event.created_at.to_rfc3339()),
    );
    if let Some(request_id) = &event.request_id {
        meta.insert(
            "requestId".to_string(),
            serde_json::Value::String(request_id.clone()),
        );
    }
    meta
}
