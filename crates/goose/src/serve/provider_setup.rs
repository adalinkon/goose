use axum::body::{Body, Bytes};
use axum::extract::Query;
use axum::http::header::CONTENT_TYPE;
use axum::routing::{get, post};
use axum::{Json, Router};
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::PathBuf;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;

use crate::serve::errors::ErrorResponse;

struct AgentCommandDef {
    id: &'static str,
    binary_name: &'static str,
    install_command: Option<&'static str>,
    auth_command: Option<&'static str>,
    auth_status_command: Option<&'static str>,
}

const AGENT_COMMAND_DEFS: &[AgentCommandDef] = &[
    AgentCommandDef {
        id: "claude-acp",
        binary_name: "claude-agent-acp",
        install_command: Some(
            "npm install -g @anthropic-ai/claude-code @agentclientprotocol/claude-agent-acp",
        ),
        auth_command: Some("claude auth login"),
        auth_status_command: Some("claude auth status"),
    },
    AgentCommandDef {
        id: "codex-acp",
        binary_name: "codex-acp",
        install_command: Some("npm install -g @openai/codex @zed-industries/codex-acp"),
        auth_command: Some("codex login"),
        auth_status_command: Some("codex login status"),
    },
    AgentCommandDef {
        id: "copilot-acp",
        binary_name: "copilot",
        install_command: Some("npm install -g @github/copilot"),
        auth_command: Some("copilot login"),
        auth_status_command: None,
    },
    AgentCommandDef {
        id: "amp-acp",
        binary_name: "amp-acp",
        install_command: Some("npm install -g @sourcegraph/amp@latest amp-acp"),
        auth_command: Some("amp login"),
        auth_status_command: Some("amp usage"),
    },
    AgentCommandDef {
        id: "cursor-agent",
        binary_name: "cursor-agent",
        install_command: Some("curl -fsSL https://cursor.com/install | bash"),
        auth_command: Some("cursor-agent login"),
        auth_status_command: Some("cursor-agent status"),
    },
    AgentCommandDef {
        id: "pi-acp",
        binary_name: "pi-acp",
        install_command: None,
        auth_command: None,
        auth_status_command: None,
    },
];

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentQuery {
    provider_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentCommandRequest {
    provider_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModelSetupRequest {
    provider_id: String,
    provider_label: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BoolResponse {
    value: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SetupEvent {
    event: String,
    provider_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    line: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    success: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

fn build_extended_path() -> String {
    let mut paths: Vec<PathBuf> = Vec::new();

    if let Ok(system_path) = std::env::var("PATH") {
        paths.extend(std::env::split_paths(&system_path).filter(|p| {
            !p.to_string_lossy().contains(".hermit") && !p.join("activate-hermit").exists()
        }));
    }

    if let Some(home) = dirs::home_dir() {
        paths.push(home.join(".local/bin"));
        paths.push(home.join(".npm-global/bin"));
    }

    paths.push(PathBuf::from("/usr/local/bin"));

    #[cfg(target_os = "macos")]
    {
        paths.push(PathBuf::from("/opt/homebrew/bin"));
        paths.push(PathBuf::from("/opt/local/bin"));
    }

    if cfg!(windows) {
        if let Some(appdata) = dirs::data_dir() {
            paths.push(appdata.join("npm"));
        }
    }

    if let Some(home) = dirs::home_dir() {
        let nvm_dir = home.join(".nvm/versions/node");
        if nvm_dir.exists() {
            if let Ok(entries) = std::fs::read_dir(&nvm_dir) {
                let mut versions: Vec<_> = entries
                    .filter_map(|e| e.ok())
                    .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
                    .collect();
                versions.sort_by_key(|b| std::cmp::Reverse(b.file_name()));
                if let Some(latest) = versions.first() {
                    paths.push(latest.path().join("bin"));
                }
            }
        }

        let fnm_dir = home.join(".local/share/fnm/node-versions");
        if fnm_dir.exists() {
            if let Ok(entries) = std::fs::read_dir(&fnm_dir) {
                let mut versions: Vec<_> = entries
                    .filter_map(|e| e.ok())
                    .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
                    .collect();
                versions.sort_by_key(|b| std::cmp::Reverse(b.file_name()));
                if let Some(latest) = versions.first() {
                    paths.push(latest.path().join("installation/bin"));
                }
            }
        }
    }

    let mut seen = HashSet::new();
    paths.retain(|p| seen.insert(p.clone()));

    std::env::join_paths(paths)
        .unwrap_or_default()
        .to_string_lossy()
        .to_string()
}

fn find_agent_command_def(provider_id: &str) -> Option<&'static AgentCommandDef> {
    AGENT_COMMAND_DEFS.iter().find(|def| def.id == provider_id)
}

fn get_agent_command_def(provider_id: &str) -> Result<&'static AgentCommandDef, ErrorResponse> {
    find_agent_command_def(provider_id).ok_or_else(|| {
        ErrorResponse::bad_request(format!("Unknown agent provider '{provider_id}'"))
    })
}

fn strip_npm_config_env(cmd: &mut tokio::process::Command) {
    for (key, _) in std::env::vars() {
        if key.starts_with("npm_config") || key.starts_with("NPM_CONFIG") {
            cmd.env_remove(&key);
        }
    }
}

async fn emit_event(tx: &mpsc::Sender<Bytes>, event: SetupEvent) {
    if let Ok(json) = serde_json::to_string(&event) {
        let _ = tx.send(Bytes::from(format!("{json}\n"))).await;
    }
}

async fn run_shell_command_stream(provider_id: String, command: String) -> Body {
    let (tx, rx) = mpsc::channel::<Bytes>(128);

    tokio::spawn(async move {
        emit_event(
            &tx,
            SetupEvent {
                event: "log".to_string(),
                provider_id: provider_id.clone(),
                line: Some(format!("Running: {command}")),
                success: None,
                error: None,
            },
        )
        .await;

        let extended_path = build_extended_path();
        let shell = if cfg!(target_os = "windows") {
            "cmd"
        } else {
            "sh"
        };
        let flag = if cfg!(target_os = "windows") {
            "/C"
        } else {
            "-c"
        };

        let mut child_cmd = tokio::process::Command::new(shell);
        child_cmd
            .arg(flag)
            .arg(&command)
            .env("PATH", &extended_path)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        strip_npm_config_env(&mut child_cmd);

        let mut child = match child_cmd.spawn() {
            Ok(child) => child,
            Err(error) => {
                emit_event(
                    &tx,
                    SetupEvent {
                        event: "done".to_string(),
                        provider_id,
                        line: None,
                        success: Some(false),
                        error: Some(format!("Failed to start command: {error}")),
                    },
                )
                .await;
                return;
            }
        };

        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        let tx_stdout = tx.clone();
        let provider_stdout = provider_id.clone();
        let stdout_task = tokio::spawn(async move {
            if let Some(stdout) = stdout {
                let mut lines = BufReader::new(stdout).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    emit_event(
                        &tx_stdout,
                        SetupEvent {
                            event: "log".to_string(),
                            provider_id: provider_stdout.clone(),
                            line: Some(line),
                            success: None,
                            error: None,
                        },
                    )
                    .await;
                }
            }
        });

        let tx_stderr = tx.clone();
        let provider_stderr = provider_id.clone();
        let stderr_task = tokio::spawn(async move {
            if let Some(stderr) = stderr {
                let mut lines = BufReader::new(stderr).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    emit_event(
                        &tx_stderr,
                        SetupEvent {
                            event: "log".to_string(),
                            provider_id: provider_stderr.clone(),
                            line: Some(line),
                            success: None,
                            error: None,
                        },
                    )
                    .await;
                }
            }
        });

        let _ = tokio::join!(stdout_task, stderr_task);

        let status = child.wait().await;
        match status {
            Ok(status) if status.success() => {
                emit_event(
                    &tx,
                    SetupEvent {
                        event: "done".to_string(),
                        provider_id,
                        line: None,
                        success: Some(true),
                        error: None,
                    },
                )
                .await;
            }
            Ok(status) => {
                emit_event(
                    &tx,
                    SetupEvent {
                        event: "done".to_string(),
                        provider_id,
                        line: None,
                        success: Some(false),
                        error: Some(format!(
                            "Command exited with code {}",
                            status.code().unwrap_or(-1)
                        )),
                    },
                )
                .await;
            }
            Err(error) => {
                emit_event(
                    &tx,
                    SetupEvent {
                        event: "done".to_string(),
                        provider_id,
                        line: None,
                        success: Some(false),
                        error: Some(format!("Failed to wait for command: {error}")),
                    },
                )
                .await;
            }
        }
    });

    let stream = ReceiverStream::new(rx).map(Ok::<_, std::convert::Infallible>);
    Body::from_stream(stream)
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

async fn check_agent_installed(
    Query(query): Query<AgentQuery>,
) -> Result<Json<BoolResponse>, ErrorResponse> {
    let def = get_agent_command_def(&query.provider_id)?;
    let extended_path = build_extended_path();

    let (cmd, flag) = if cfg!(target_os = "windows") {
        ("where", "/Q")
    } else {
        ("which", "")
    };

    let mut command = std::process::Command::new(cmd);
    if !flag.is_empty() {
        command.arg(flag);
    }
    command.arg(def.binary_name);
    command.env("PATH", &extended_path);

    let installed = command
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false);

    Ok(Json(BoolResponse { value: installed }))
}

async fn check_agent_auth(
    Query(query): Query<AgentQuery>,
) -> Result<Json<BoolResponse>, ErrorResponse> {
    let def = get_agent_command_def(&query.provider_id)?;
    let Some(auth_status_command) = def.auth_status_command else {
        return Ok(Json(BoolResponse { value: false }));
    };

    let extended_path = build_extended_path();
    let shell = if cfg!(target_os = "windows") {
        "cmd"
    } else {
        "sh"
    };
    let flag = if cfg!(target_os = "windows") {
        "/C"
    } else {
        "-c"
    };

    let authenticated = std::process::Command::new(shell)
        .arg(flag)
        .arg(auth_status_command)
        .env("PATH", &extended_path)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .output()
        .map(|output| output.status.success())
        .map_err(|e| ErrorResponse::internal(format!("Failed to check auth status: {e}")))?;

    Ok(Json(BoolResponse {
        value: authenticated,
    }))
}

async fn install_agent(
    Json(request): Json<AgentCommandRequest>,
) -> Result<(axum::http::HeaderMap, Body), ErrorResponse> {
    let def = get_agent_command_def(&request.provider_id)?;
    let install_command = def.install_command.ok_or_else(|| {
        ErrorResponse::bad_request(format!(
            "Agent provider '{}' does not support install",
            request.provider_id
        ))
    })?;

    let mut headers = axum::http::HeaderMap::new();
    headers.insert(
        CONTENT_TYPE,
        axum::http::HeaderValue::from_static("application/x-ndjson"),
    );
    Ok((
        headers,
        run_shell_command_stream(request.provider_id, install_command.to_string()).await,
    ))
}

async fn authenticate_agent(
    Json(request): Json<AgentCommandRequest>,
) -> Result<(axum::http::HeaderMap, Body), ErrorResponse> {
    let def = get_agent_command_def(&request.provider_id)?;
    let auth_command = def.auth_command.ok_or_else(|| {
        ErrorResponse::bad_request(format!(
            "Agent provider '{}' does not support auth",
            request.provider_id
        ))
    })?;

    let mut headers = axum::http::HeaderMap::new();
    headers.insert(
        CONTENT_TYPE,
        axum::http::HeaderValue::from_static("application/x-ndjson"),
    );
    Ok((
        headers,
        run_shell_command_stream(request.provider_id, auth_command.to_string()).await,
    ))
}

async fn authenticate_model_provider(
    Json(request): Json<ModelSetupRequest>,
) -> Result<(axum::http::HeaderMap, Body), ErrorResponse> {
    if cfg!(target_os = "windows") {
        return Err(ErrorResponse::bad_request(
            "Native Goose sign-in is not supported on Windows yet",
        ));
    }

    let quoted_label = shell_quote(&request.provider_label);
    let quoted_binary = shell_quote("goose");

    let command = if cfg!(target_os = "linux") {
        format!(
            "printf '\\n%s\\n' {quoted_label} | script -qf /dev/null -c '{quoted_binary} configure'",
        )
    } else {
        format!("printf '\\n%s\\n' {quoted_label} | script -q /dev/null {quoted_binary} configure",)
    };

    let mut headers = axum::http::HeaderMap::new();
    headers.insert(
        CONTENT_TYPE,
        axum::http::HeaderValue::from_static("application/x-ndjson"),
    );
    Ok((
        headers,
        run_shell_command_stream(request.provider_id, command).await,
    ))
}

pub fn routes() -> Router {
    Router::new()
        .route(
            "/providers/setup/agent/check-installed",
            get(check_agent_installed),
        )
        .route("/providers/setup/agent/check-auth", get(check_agent_auth))
        .route("/providers/setup/agent/install", post(install_agent))
        .route(
            "/providers/setup/agent/authenticate",
            post(authenticate_agent),
        )
        .route(
            "/providers/setup/model/authenticate",
            post(authenticate_model_provider),
        )
}
