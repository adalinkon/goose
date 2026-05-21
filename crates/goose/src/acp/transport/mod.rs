pub mod connection;
pub mod http;
pub mod websocket;

use std::collections::HashMap;
use std::sync::Arc;

use axum::{
    body::Body,
    extract::{
        ws::{rejection::WebSocketUpgradeRejection, WebSocketUpgrade},
        State,
    },
    http::{header, HeaderName, Method, Request, StatusCode},
    middleware::{self, Next},
    response::Response,
    routing::{delete, get, post},
    Router,
};
use serde_json::Value;
use tower_http::cors::{Any, CorsLayer};

use crate::acp::server_factory::AcpServer;

pub(crate) const HEADER_CONNECTION_ID: &str = "Acp-Connection-Id";
pub(crate) const HEADER_SESSION_ID: &str = "Acp-Session-Id";
pub(crate) const EVENT_STREAM_MIME_TYPE: &str = "text/event-stream";
pub(crate) const JSON_MIME_TYPE: &str = "application/json";

pub(crate) fn accepts_mime_type(request: &Request<Body>, mime_type: &str) -> bool {
    request
        .headers()
        .get(axum::http::header::ACCEPT)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|accept| accept.contains(mime_type))
}

pub(crate) fn content_type_is_json(request: &Request<Body>) -> bool {
    request
        .headers()
        .get(axum::http::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|ct| ct.starts_with(JSON_MIME_TYPE))
}

pub(crate) fn header_value(request: &Request<Body>, name: &str) -> Option<String> {
    request
        .headers()
        .get(name)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
}

fn query_value(request: &Request<Body>, name: &str) -> Option<String> {
    request.uri().query().and_then(|query| {
        serde_urlencoded::from_str::<HashMap<String, String>>(query)
            .ok()
            .and_then(|params| params.get(name).cloned())
    })
}

pub(crate) fn is_jsonrpc_request_with_id(value: &Value) -> bool {
    value.get("method").is_some() && value.get("id").is_some()
}

pub(crate) fn is_jsonrpc_notification(value: &Value) -> bool {
    value.get("method").is_some() && value.get("id").is_none()
}

pub(crate) fn is_jsonrpc_response(value: &Value) -> bool {
    value.get("id").is_some()
        && value.get("method").is_none()
        && (value.get("result").is_some() || value.get("error").is_some())
}

pub(crate) fn is_initialize_request(value: &Value) -> bool {
    value.get("method").is_some_and(|m| m == "initialize") && value.get("id").is_some()
}

/// Methods that are scoped to a session and require an Acp-Session-Id header.
pub(crate) fn method_requires_session_header(method: &str) -> bool {
    matches!(
        method,
        "session/prompt"
            | "session/cancel"
            | "session/load"
            | "session/set_mode"
            | "session/set_model"
    )
}

async fn handle_get(
    ws_upgrade: Result<WebSocketUpgrade, WebSocketUpgradeRejection>,
    State(state): State<Arc<connection::ConnectionRegistry>>,
    request: Request<Body>,
) -> Response {
    match ws_upgrade {
        Ok(ws) => websocket::handle_ws_upgrade(state, ws).await,
        Err(_) => http::handle_get(state, request).await,
    }
}

async fn health() -> &'static str {
    "ok"
}

fn acp_cors_layer() -> CorsLayer {
    CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers([
            header::CONTENT_TYPE,
            header::ACCEPT,
            HeaderName::from_static("x-secret-key"),
            HeaderName::from_static("acp-connection-id"),
            HeaderName::from_static("acp-session-id"),
            header::SEC_WEBSOCKET_VERSION,
            header::SEC_WEBSOCKET_KEY,
            header::CONNECTION,
            header::UPGRADE,
        ])
        .expose_headers([
            HeaderName::from_static("acp-connection-id"),
            HeaderName::from_static("acp-session-id"),
        ])
}

async fn check_secret_key(
    State(secret_key): State<String>,
    request: Request<Body>,
    next: Next,
) -> Result<Response, StatusCode> {
    if matches!(request.uri().path(), "/health" | "/status") {
        return Ok(next.run(request).await);
    }

    let request_secret = request
        .headers()
        .get("X-Secret-Key")
        .and_then(|value| value.to_str().ok())
        .map(ToString::to_string)
        .or_else(|| query_value(&request, "secret"));

    if request_secret.as_deref() == Some(secret_key.as_str()) {
        Ok(next.run(request).await)
    } else {
        Err(StatusCode::UNAUTHORIZED)
    }
}

fn create_acp_routes(server: Arc<AcpServer>) -> Router {
    let registry = Arc::new(connection::ConnectionRegistry::new(server));

    Router::new()
        .route("/acp", post(http::handle_post).with_state(registry.clone()))
        .route("/acp", get(handle_get).with_state(registry.clone()))
        .route("/acp", delete(http::handle_delete).with_state(registry))
}

pub fn create_acp_router(server: Arc<AcpServer>) -> Router {
    create_acp_routes(server).layer(acp_cors_layer())
}

pub fn create_router(server: Arc<AcpServer>, secret_key: String) -> Router {
    create_acp_routes(server)
        .route("/health", get(health))
        .route("/status", get(health))
        .merge(crate::serve::routes())
        .merge(super::mcp_app_proxy::routes(secret_key.clone()))
        .layer(middleware::from_fn_with_state(secret_key, check_secret_key))
        .layer(acp_cors_layer())
}

#[cfg(test)]
mod tests {
    use super::create_router;
    use crate::acp::server_factory::{AcpServer, AcpServerFactoryConfig};
    use crate::agents::GoosePlatform;
    use axum::body::Body;
    use axum::extract::connect_info::MockConnectInfo;
    use axum::http::{header, Method, Request, StatusCode};
    use http_body_util::BodyExt as _;
    use serial_test::serial;
    use std::net::SocketAddr;
    use std::sync::Arc;
    use tower::ServiceExt;

    fn test_router(secret_key: &str, root: &std::path::Path) -> axum::Router {
        let server = Arc::new(AcpServer::new(AcpServerFactoryConfig {
            builtins: vec![],
            data_dir: root.to_path_buf(),
            config_dir: root.to_path_buf(),
            goose_platform: GoosePlatform::GooseCli,
            additional_source_roots: Vec::new(),
        }));

        create_router(server, secret_key.to_string())
            .layer(MockConnectInfo(SocketAddr::from(([127, 0, 0, 1], 12345))))
    }

    fn request(method: Method, uri: &str, secret_key: Option<&str>, body: Body) -> Request<Body> {
        let mut builder = Request::builder().method(method).uri(uri);
        if let Some(secret_key) = secret_key {
            builder = builder.header("X-Secret-Key", secret_key);
        }
        builder.body(body).expect("request")
    }

    async fn response_text(response: axum::response::Response) -> String {
        let bytes = response
            .into_body()
            .collect()
            .await
            .expect("body")
            .to_bytes();
        String::from_utf8(bytes.to_vec()).expect("utf8 response body")
    }

    #[tokio::test]
    #[serial]
    async fn routes_require_secret_but_allow_health_and_acp_init_preflight() {
        let root = tempfile::tempdir().expect("tempdir");
        let _env = env_lock::lock_env([
            ("HOME", Some(root.path().to_string_lossy().as_ref())),
            (
                "GOOSE_SERVE__WORKING_ROOT",
                Some(root.path().to_string_lossy().as_ref()),
            ),
            (
                "GOOSE_SERVER__WORKING_ROOT",
                Some(root.path().to_string_lossy().as_ref()),
            ),
        ]);

        let app = test_router("test-secret", root.path());

        let health = app
            .clone()
            .oneshot(request(Method::GET, "/health", None, Body::empty()))
            .await
            .expect("health response");
        assert_eq!(health.status(), StatusCode::OK);
        assert_eq!(response_text(health).await, "ok");

        let status = app
            .clone()
            .oneshot(request(Method::GET, "/status", None, Body::empty()))
            .await
            .expect("status response");
        assert_eq!(status.status(), StatusCode::OK);
        assert_eq!(response_text(status).await, "ok");

        let unauthorized = app
            .clone()
            .oneshot(request(Method::GET, "/fs/home-dir", None, Body::empty()))
            .await
            .expect("unauthorized response");
        assert_eq!(unauthorized.status(), StatusCode::UNAUTHORIZED);

        let acp_unauthorized = app
            .clone()
            .oneshot(request(Method::GET, "/acp", None, Body::empty()))
            .await
            .expect("acp unauthorized response");
        assert_eq!(acp_unauthorized.status(), StatusCode::UNAUTHORIZED);

        let acp_preflight = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri("/acp")
                    .header(header::ACCEPT, "text/event-stream")
                    .header("X-Secret-Key", "test-secret")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("acp preflight response");
        assert_eq!(acp_preflight.status(), StatusCode::BAD_REQUEST);
        assert!(response_text(acp_preflight)
            .await
            .contains("Acp-Connection-Id header required"));
    }

    #[tokio::test]
    #[serial]
    async fn migrated_serve_routes_work_with_secret() {
        let root = tempfile::tempdir().expect("tempdir");
        let _env = env_lock::lock_env([
            ("HOME", Some(root.path().to_string_lossy().as_ref())),
            (
                "GOOSE_SERVE__WORKING_ROOT",
                Some(root.path().to_string_lossy().as_ref()),
            ),
            (
                "GOOSE_SERVER__WORKING_ROOT",
                Some(root.path().to_string_lossy().as_ref()),
            ),
            ("GOOSE_DISTRO_DIR", None),
        ]);

        let app = test_router("test-secret", root.path());

        let doctor = app
            .clone()
            .oneshot(request(
                Method::GET,
                "/doctor/distro",
                Some("test-secret"),
                Body::empty(),
            ))
            .await
            .expect("doctor response");
        assert_eq!(doctor.status(), StatusCode::OK);
        let doctor_body: serde_json::Value =
            serde_json::from_str(&response_text(doctor).await).expect("doctor json");
        assert_eq!(doctor_body["present"], serde_json::json!(false));

        let home_dir = app
            .clone()
            .oneshot(request(
                Method::GET,
                "/fs/home-dir",
                Some("test-secret"),
                Body::empty(),
            ))
            .await
            .expect("home-dir response");
        assert_eq!(home_dir.status(), StatusCode::OK);
        let home_body: serde_json::Value =
            serde_json::from_str(&response_text(home_dir).await).expect("home-dir json");
        assert_eq!(
            home_body["path"],
            serde_json::json!(root.path().to_string_lossy().to_string())
        );

        let git_state = app
            .clone()
            .oneshot(request(
                Method::GET,
                "/git/state?path=.",
                Some("test-secret"),
                Body::empty(),
            ))
            .await
            .expect("git state response");
        assert_eq!(git_state.status(), StatusCode::OK);
        let git_body: serde_json::Value =
            serde_json::from_str(&response_text(git_state).await).expect("git state json");
        assert_eq!(git_body["isGitRepo"], serde_json::json!(false));

        let provider_auth = app
            .clone()
            .oneshot(request(
                Method::GET,
                "/providers/setup/agent/check-auth?providerId=pi-acp",
                Some("test-secret"),
                Body::empty(),
            ))
            .await
            .expect("provider auth response");
        assert_eq!(provider_auth.status(), StatusCode::OK);
        let provider_body: serde_json::Value =
            serde_json::from_str(&response_text(provider_auth).await).expect("provider auth json");
        assert_eq!(provider_body["value"], serde_json::json!(false));
    }
}
