use std::collections::HashMap;
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::{Duration, Instant};

use once_cell::sync::Lazy;
use tokio::process::{Child, Command};
use tokio::sync::Mutex;
use tracing::warn;

use crate::agents::extension::{ExtensionError, ExtensionResult, StreamableHttpBackendConfig};
use crate::agents::extension_malware_check;
use crate::agents::mcp_client::McpClientTrait;
use crate::agents::tool_execution::ToolCallContext;
use crate::config::search_path::SearchPaths;
use crate::prompt_template;
use crate::subprocess::configure_subprocess;
use rmcp::model::{
    CallToolResult, GetPromptResult, JsonObject, ListPromptsResult, ListResourcesResult,
    ListToolsResult, ReadResourceResult, ServerNotification,
};
use rmcp::service::ServiceError;
use serde_json::Value;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

static BACKENDS: Lazy<Mutex<HashMap<String, Arc<BackendSlot>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

const DEFAULT_BACKEND_IDLE_TIMEOUT_SECS: u64 = 300;

#[derive(Clone, serde::Serialize)]
pub(crate) struct BackendTemplateContext {
    pub extension_name: String,
    pub session_id: String,
    pub workdir: String,
    pub working_dir: String,
    pub port: String,
}

pub(crate) struct BackendLease {
    id: String,
    slot: Arc<BackendSlot>,
    port: u16,
}

pub(crate) struct BackendMcpClient {
    inner: Arc<dyn McpClientTrait>,
    lease: BackendLease,
}

impl BackendMcpClient {
    pub(crate) fn new(inner: Arc<dyn McpClientTrait>, lease: BackendLease) -> Self {
        Self { inner, lease }
    }
}

#[async_trait::async_trait]
impl McpClientTrait for BackendMcpClient {
    async fn list_tools(
        &self,
        session_id: &str,
        next_cursor: Option<String>,
        cancel_token: CancellationToken,
    ) -> Result<ListToolsResult, ServiceError> {
        self.lease.touch().await;
        self.inner
            .list_tools(session_id, next_cursor, cancel_token)
            .await
    }

    async fn call_tool(
        &self,
        ctx: &ToolCallContext,
        name: &str,
        arguments: Option<JsonObject>,
        cancel_token: CancellationToken,
    ) -> Result<CallToolResult, ServiceError> {
        self.lease.touch().await;
        self.inner
            .call_tool(ctx, name, arguments, cancel_token)
            .await
    }

    fn get_info(&self) -> Option<&rmcp::model::InitializeResult> {
        self.inner.get_info()
    }

    async fn list_resources(
        &self,
        session_id: &str,
        next_cursor: Option<String>,
        cancel_token: CancellationToken,
    ) -> Result<ListResourcesResult, ServiceError> {
        self.lease.touch().await;
        self.inner
            .list_resources(session_id, next_cursor, cancel_token)
            .await
    }

    async fn read_resource(
        &self,
        session_id: &str,
        uri: &str,
        cancel_token: CancellationToken,
    ) -> Result<ReadResourceResult, ServiceError> {
        self.lease.touch().await;
        self.inner
            .read_resource(session_id, uri, cancel_token)
            .await
    }

    async fn list_prompts(
        &self,
        session_id: &str,
        next_cursor: Option<String>,
        cancel_token: CancellationToken,
    ) -> Result<ListPromptsResult, ServiceError> {
        self.lease.touch().await;
        self.inner
            .list_prompts(session_id, next_cursor, cancel_token)
            .await
    }

    async fn get_prompt(
        &self,
        session_id: &str,
        name: &str,
        arguments: Value,
        cancel_token: CancellationToken,
    ) -> Result<GetPromptResult, ServiceError> {
        self.lease.touch().await;
        self.inner
            .get_prompt(session_id, name, arguments, cancel_token)
            .await
    }

    async fn subscribe(&self) -> mpsc::Receiver<ServerNotification> {
        self.inner.subscribe().await
    }

    async fn get_moim(&self, session_id: &str) -> Option<String> {
        self.lease.touch().await;
        self.inner.get_moim(session_id).await
    }

    async fn update_working_dir(&self, new_dir: PathBuf) -> Result<(), ServiceError> {
        self.inner.update_working_dir(new_dir).await
    }
}

impl BackendLease {
    pub(crate) fn port(&self) -> u16 {
        self.port
    }

    pub(crate) async fn touch(&self) {
        let mut state = self.slot.state.lock().await;
        if let Some(process) = state.process.as_mut() {
            process.last_activity = Instant::now();
        }
    }
}

impl Drop for BackendLease {
    fn drop(&mut self) {
        let id = self.id.clone();
        let slot = Arc::clone(&self.slot);
        if let Ok(handle) = tokio::runtime::Handle::try_current() {
            handle.spawn(async move {
                release_backend(id, slot).await;
            });
        }
    }
}

struct BackendSlot {
    state: Mutex<BackendState>,
}

#[derive(Default)]
struct BackendState {
    process: Option<BackendProcess>,
}

struct BackendProcess {
    child: Child,
    port: u16,
    refs: usize,
    last_activity: Instant,
    idle_timeout: Duration,
}

pub(crate) fn render_backend_template(
    value: &str,
    context: &BackendTemplateContext,
) -> ExtensionResult<String> {
    prompt_template::render_string(value, context).map_err(|e| {
        ExtensionError::ConfigError(format!(
            "failed to render streamable_http backend template: {e}"
        ))
    })
}

pub(crate) fn context_without_port(
    name: &str,
    session_id: Option<&str>,
    working_dir: &Path,
) -> BackendTemplateContext {
    let working_dir = working_dir.to_string_lossy().to_string();
    BackendTemplateContext {
        extension_name: name.to_string(),
        session_id: session_id.unwrap_or_default().to_string(),
        workdir: working_dir.clone(),
        working_dir,
        port: String::new(),
    }
}

pub(crate) fn context_with_port(
    mut context: BackendTemplateContext,
    port: u16,
) -> BackendTemplateContext {
    context.port = port.to_string();
    context
}

pub(crate) async fn acquire_backend(
    backend: &StreamableHttpBackendConfig,
    envs: &HashMap<String, String>,
    context: &BackendTemplateContext,
    working_dir: &Path,
) -> ExtensionResult<BackendLease> {
    let rendered_id = render_backend_template(
        &crate::agents::extension_manager::substitute_env_vars(&backend.id, envs),
        context,
    )?;
    if rendered_id.trim().is_empty() {
        return Err(ExtensionError::ConfigError(
            "streamable_http backend id must not render to an empty string".to_string(),
        ));
    }

    let slot = {
        let mut backends = BACKENDS.lock().await;
        backends
            .entry(rendered_id.clone())
            .or_insert_with(|| {
                Arc::new(BackendSlot {
                    state: Mutex::new(BackendState::default()),
                })
            })
            .clone()
    };

    let mut state = slot.state.lock().await;
    if let Some(process) = state.process.as_mut() {
        if process.child.try_wait()?.is_none() {
            process.refs += 1;
            process.last_activity = Instant::now();
            let port = process.port;
            drop(state);
            return Ok(BackendLease {
                id: rendered_id,
                slot,
                port,
            });
        }
        state.process = None;
    }

    let port = reserve_port()?;
    let context = context_with_port(context.clone(), port);
    let mut command = build_command(backend, envs, &context, working_dir).await?;
    let child = command.spawn()?;

    state.process = Some(BackendProcess {
        child,
        port,
        refs: 1,
        last_activity: Instant::now(),
        idle_timeout: Duration::from_secs(
            backend
                .idle_timeout
                .unwrap_or(DEFAULT_BACKEND_IDLE_TIMEOUT_SECS),
        ),
    });
    drop(state);

    spawn_idle_monitor(rendered_id.clone(), Arc::clone(&slot));

    Ok(BackendLease {
        id: rendered_id,
        slot,
        port,
    })
}

async fn build_command(
    backend: &StreamableHttpBackendConfig,
    envs: &HashMap<String, String>,
    context: &BackendTemplateContext,
    working_dir: &Path,
) -> ExtensionResult<Command> {
    let cmd = crate::agents::extension_manager::substitute_env_vars(&backend.cmd, envs);
    let cmd = render_backend_template(&cmd, context)?;
    let args = backend
        .args
        .iter()
        .map(|arg| {
            let arg = crate::agents::extension_manager::substitute_env_vars(arg, envs);
            render_backend_template(&arg, context)
        })
        .collect::<ExtensionResult<Vec<_>>>()?;

    extension_malware_check::deny_if_malicious_cmd_args(&cmd, &args).await?;

    let mut rendered_envs = HashMap::new();
    for (key, value) in envs {
        let value = crate::agents::extension_manager::substitute_env_vars(value, envs);
        rendered_envs.insert(key.clone(), render_backend_template(&value, context)?);
    }

    let cmd_path = SearchPaths::builder()
        .with_npm()
        .resolve(&cmd)
        .unwrap_or_else(|_| PathBuf::from(&cmd));

    let mut command = Command::new(cmd_path);
    command
        .args(args)
        .envs(rendered_envs)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    configure_subprocess(&mut command);

    if let Ok(path) = SearchPaths::builder().path() {
        command.env("PATH", path);
    }

    if working_dir.exists() && working_dir.is_dir() {
        command.current_dir(working_dir);
    } else {
        warn!(
            "Streamable HTTP backend working directory doesn't exist or isn't a directory: {:?}",
            working_dir
        );
    }

    Ok(command)
}

async fn release_backend(id: String, slot: Arc<BackendSlot>) {
    let mut state = slot.state.lock().await;
    let Some(process) = state.process.as_mut() else {
        return;
    };

    process.refs = process.refs.saturating_sub(1);
    process.last_activity = Instant::now();
    if process.refs > 0 {
        return;
    }

    if let Some(mut process) = state.process.take() {
        let _ = process.child.start_kill();
        let _ = process.child.wait().await;
    }
    drop(state);

    let mut backends = BACKENDS.lock().await;
    if backends
        .get(&id)
        .is_some_and(|existing| Arc::ptr_eq(existing, &slot))
    {
        backends.remove(&id);
    }
}

fn spawn_idle_monitor(id: String, slot: Arc<BackendSlot>) {
    tokio::spawn(async move {
        loop {
            let sleep_for = {
                let mut state = slot.state.lock().await;
                let Some(process) = state.process.as_mut() else {
                    break;
                };

                match process.child.try_wait() {
                    Ok(Some(_)) => {
                        state.process = None;
                        None
                    }
                    Ok(None) if process.last_activity.elapsed() >= process.idle_timeout => {
                        if let Some(mut process) = state.process.take() {
                            let _ = process.child.start_kill();
                            let _ = process.child.wait().await;
                        }
                        None
                    }
                    Ok(None) => {
                        let remaining = process
                            .idle_timeout
                            .saturating_sub(process.last_activity.elapsed());
                        Some(remaining.min(Duration::from_secs(30)))
                    }
                    Err(e) => {
                        warn!("Failed to poll streamable HTTP backend '{}': {}", id, e);
                        state.process = None;
                        None
                    }
                }
            };

            if let Some(duration) = sleep_for {
                tokio::time::sleep(duration).await;
            } else {
                let mut backends = BACKENDS.lock().await;
                if backends
                    .get(&id)
                    .is_some_and(|existing| Arc::ptr_eq(existing, &slot))
                {
                    backends.remove(&id);
                }
                break;
            }
        }
    });
}

fn reserve_port() -> ExtensionResult<u16> {
    let listener = TcpListener::bind(("127.0.0.1", 0))?;
    Ok(listener.local_addr()?.port())
}
