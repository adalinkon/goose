use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};

use agent_client_protocol::schema::{Meta, SessionInfoUpdate, SessionUpdate};
use serde::{Deserialize, Serialize};
use tokio::sync::{broadcast, Mutex, RwLock};

const SESSION_EVENT_BUFFER_CAPACITY: usize = 1024;
const RUNTIME_PROTOCOL_VERSION: u8 = 1;

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
    pub identity: RuntimeEventIdentity,
    pub update: SessionUpdate,
}

#[derive(Debug, Clone, Default)]
pub struct RuntimeEventIdentity {
    pub message_id: Option<String>,
    pub message_created: Option<i64>,
    pub tool_call_id: Option<String>,
}

impl RuntimeEventIdentity {
    pub fn with_tool_call_id(mut self, tool_call_id: impl Into<String>) -> Self {
        self.tool_call_id = Some(tool_call_id.into());
        self
    }
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum GlobalEvent {
    SessionIndex(SessionIndexEvent),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "event")]
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionRuntimeIndexStatus {
    #[default]
    Idle,
    Running,
    Wait,
    Dead,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionRuntimeIndexState {
    pub status: SessionRuntimeIndexStatus,
}

pub struct GlobalEventBus {
    tx: broadcast::Sender<GlobalEvent>,
}

impl GlobalEventBus {
    pub fn new() -> Self {
        let (tx, _) = broadcast::channel(SESSION_EVENT_BUFFER_CAPACITY);
        Self { tx }
    }

    pub fn publish(&self, event: GlobalEvent) {
        let _ = self.tx.send(event);
    }

    pub fn subscribe(&self) -> broadcast::Receiver<GlobalEvent> {
        self.tx.subscribe()
    }
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
        identity: RuntimeEventIdentity,
        update: SessionUpdate,
    ) -> RuntimeEvent {
        self.publish(
            session_id,
            runtime_event_kind(&update),
            RuntimeEventDelivery::Replay,
            request_id,
            identity,
            update,
        )
        .await
    }

    pub async fn publish_tool_call_update(
        &self,
        session_id: &str,
        request_id: Option<String>,
        identity: RuntimeEventIdentity,
        update: SessionUpdate,
    ) -> RuntimeEvent {
        self.publish(
            session_id,
            RuntimeEventKind::ChatToolCallUpdate,
            RuntimeEventDelivery::Replay,
            request_id,
            identity,
            update,
        )
        .await
    }

    pub async fn publish_usage_update(
        &self,
        session_id: &str,
        request_id: Option<String>,
        update: SessionUpdate,
    ) -> RuntimeEvent {
        self.publish(
            session_id,
            RuntimeEventKind::SessionUsageUpdate,
            RuntimeEventDelivery::Replay,
            request_id,
            RuntimeEventIdentity::default(),
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
        identity: RuntimeEventIdentity,
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
            identity,
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
            identity: RuntimeEventIdentity::default(),
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
    SessionUsageUpdate,
}

fn runtime_event_kind(update: &SessionUpdate) -> RuntimeEventKind {
    match update {
        SessionUpdate::AgentMessageChunk(_) => RuntimeEventKind::ChatAgentChunk,
        SessionUpdate::AgentThoughtChunk(_) => RuntimeEventKind::ChatThoughtChunk,
        SessionUpdate::ToolCall(_) => RuntimeEventKind::ChatToolCall,
        SessionUpdate::ToolCallUpdate(_) => RuntimeEventKind::ChatToolCallUpdate,
        SessionUpdate::UsageUpdate(_) => RuntimeEventKind::SessionUsageUpdate,
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
        RuntimeEventKind::SessionUsageUpdate => "session.usage_update",
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
    meta.insert(
        "goose".to_string(),
        serde_json::Value::Object(runtime_event_goose_meta(event)),
    );
    meta
}

fn runtime_event_goose_meta(event: &RuntimeEvent) -> serde_json::Map<String, serde_json::Value> {
    let mut goose = update_goose_meta(&event.update).unwrap_or_default();
    if let Some(message_id) = &event.identity.message_id {
        goose.insert(
            "messageId".to_string(),
            serde_json::Value::String(message_id.clone()),
        );
    }
    if let Some(created) = event.identity.message_created {
        goose.insert("created".to_string(), serde_json::json!(created));
    }
    if let Some(request_id) = &event.request_id {
        goose.insert(
            "requestId".to_string(),
            serde_json::Value::String(request_id.clone()),
        );
    }

    let mut runtime = serde_json::Map::new();
    runtime.insert(
        "protocolVersion".to_string(),
        serde_json::json!(RUNTIME_PROTOCOL_VERSION),
    );
    runtime.insert(
        "eventId".to_string(),
        serde_json::Value::String(format!("{}:{}", event.session_id, event.seq)),
    );
    runtime.insert("seq".to_string(), serde_json::json!(event.seq));
    runtime.insert(
        "kind".to_string(),
        serde_json::Value::String(event.kind.clone()),
    );
    runtime.insert(
        "delivery".to_string(),
        serde_json::Value::String(event.delivery.as_str().to_string()),
    );
    if let Some(request_id) = &event.request_id {
        runtime.insert(
            "requestId".to_string(),
            serde_json::Value::String(request_id.clone()),
        );
    }
    if let Some(message_id) = &event.identity.message_id {
        runtime.insert(
            "messageId".to_string(),
            serde_json::Value::String(message_id.clone()),
        );
    }
    if let Some(tool_call_id) = &event.identity.tool_call_id {
        runtime.insert(
            "toolCallId".to_string(),
            serde_json::Value::String(tool_call_id.clone()),
        );
    }
    goose.insert("runtime".to_string(), serde_json::Value::Object(runtime));
    goose
}

fn update_goose_meta(update: &SessionUpdate) -> Option<serde_json::Map<String, serde_json::Value>> {
    let meta = match update {
        SessionUpdate::AgentMessageChunk(update) | SessionUpdate::AgentThoughtChunk(update) => {
            update.meta.as_ref()
        }
        SessionUpdate::ToolCall(update) => update.meta.as_ref(),
        SessionUpdate::ToolCallUpdate(update) => update.meta.as_ref(),
        SessionUpdate::UsageUpdate(update) => update.meta.as_ref(),
        SessionUpdate::SessionInfoUpdate(update) => update.meta.as_ref(),
        _ => None,
    }?;
    match meta.get("goose") {
        Some(serde_json::Value::Object(goose)) => Some(goose.clone()),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use agent_client_protocol::schema::{
        ContentBlock, ContentChunk, SessionUpdate, TextContent, ToolCallId, ToolCallUpdate,
        ToolCallUpdateFields,
    };

    #[test]
    fn runtime_event_meta_includes_identity_and_preserves_update_goose_meta() {
        let mut tool_call = serde_json::Map::new();
        tool_call.insert("name".to_string(), serde_json::json!("shell"));
        let mut goose = serde_json::Map::new();
        goose.insert(
            "toolCall".to_string(),
            serde_json::Value::Object(tool_call.clone()),
        );
        let mut update_meta = serde_json::Map::new();
        update_meta.insert("goose".to_string(), serde_json::Value::Object(goose));

        let event = RuntimeEvent {
            seq: 12,
            session_id: "session-id".to_string(),
            kind: "chat.tool_call_update".to_string(),
            delivery: RuntimeEventDelivery::Replay,
            created_at: chrono::DateTime::from_timestamp(1_710_000_000, 0).unwrap(),
            request_id: Some("request-id".to_string()),
            identity: RuntimeEventIdentity {
                message_id: Some("message-id".to_string()),
                message_created: Some(1_710_000_000),
                tool_call_id: Some("tool-call-id".to_string()),
            },
            update: SessionUpdate::ToolCallUpdate(
                ToolCallUpdate::new(ToolCallId::new("tool-call-id"), ToolCallUpdateFields::new())
                    .meta(update_meta),
            ),
        };

        let meta = runtime_event_meta(&event);
        assert_eq!(meta.get("seq"), Some(&serde_json::json!(12)));
        assert_eq!(
            meta.get("kind"),
            Some(&serde_json::json!("chat.tool_call_update"))
        );
        assert_eq!(meta.get("delivery"), Some(&serde_json::json!("replay")));
        assert_eq!(
            meta.get("requestId"),
            Some(&serde_json::json!("request-id"))
        );

        let goose = meta
            .get("goose")
            .and_then(|value| value.as_object())
            .unwrap();
        assert_eq!(
            goose.get("messageId"),
            Some(&serde_json::json!("message-id"))
        );
        assert_eq!(
            goose.get("created"),
            Some(&serde_json::json!(1_710_000_000))
        );
        assert_eq!(
            goose.get("toolCall").and_then(|value| value.as_object()),
            Some(&tool_call)
        );

        let runtime = goose
            .get("runtime")
            .and_then(|value| value.as_object())
            .unwrap();
        assert_eq!(runtime.get("protocolVersion"), Some(&serde_json::json!(1)));
        assert_eq!(
            runtime.get("eventId"),
            Some(&serde_json::json!("session-id:12"))
        );
        assert_eq!(
            runtime.get("toolCallId"),
            Some(&serde_json::json!("tool-call-id"))
        );
    }

    #[test]
    fn runtime_event_meta_supports_usage_without_message_identity() {
        let event = RuntimeEvent {
            seq: 7,
            session_id: "session-id".to_string(),
            kind: "session.usage_update".to_string(),
            delivery: RuntimeEventDelivery::Replay,
            created_at: chrono::Utc::now(),
            request_id: None,
            identity: RuntimeEventIdentity::default(),
            update: SessionUpdate::AgentMessageChunk(ContentChunk::new(ContentBlock::Text(
                TextContent::new("unused"),
            ))),
        };

        let meta = runtime_event_meta(&event);
        let goose = meta
            .get("goose")
            .and_then(|value| value.as_object())
            .unwrap();
        assert!(goose.get("messageId").is_none());
        assert_eq!(
            goose.get("runtime").and_then(|value| value.get("eventId")),
            Some(&serde_json::json!("session-id:7"))
        );
    }
}
