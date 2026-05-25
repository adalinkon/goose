use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

use crate::serve::errors::ErrorResponse;

pub use doctor::{DoctorReport, FixType};

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DistroManifest {
    pub app_version: Option<String>,
    pub feature_toggles: Option<HashMap<String, bool>>,
    pub extension_allowlist: Option<String>,
    pub provider_allowlist: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DistroBundleInfo {
    pub present: bool,
    pub app_version: Option<String>,
    pub feature_toggles: Option<HashMap<String, bool>>,
    pub extension_allowlist: Option<String>,
    pub provider_allowlist: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DoctorFixRequest {
    check_id: String,
    fix_type: FixType,
}

async fn run_doctor() -> Json<DoctorReport> {
    Json(doctor::run_checks().await)
}

async fn run_doctor_fix(
    Json(request): Json<DoctorFixRequest>,
) -> Result<Json<serde_json::Value>, ErrorResponse> {
    doctor::execute_fix(request.check_id, request.fix_type)
        .await
        .map_err(ErrorResponse::bad_request)?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

fn read_manifest(path: &std::path::Path) -> Result<DistroManifest, ErrorResponse> {
    let contents = std::fs::read_to_string(path).map_err(|error| {
        ErrorResponse::internal(format!(
            "Failed to read distro manifest '{}': {error}",
            path.display()
        ))
    })?;

    serde_json::from_str::<DistroManifest>(&contents).map_err(|error| {
        ErrorResponse::internal(format!(
            "Failed to parse distro manifest '{}': {error}",
            path.display()
        ))
    })
}

async fn get_distro_bundle() -> Result<Json<DistroBundleInfo>, ErrorResponse> {
    let Some(root_dir) = std::env::var_os("GOOSE_DISTRO_DIR").map(PathBuf::from) else {
        return Ok(Json(DistroBundleInfo {
            present: false,
            app_version: None,
            feature_toggles: None,
            extension_allowlist: None,
            provider_allowlist: None,
        }));
    };

    if !root_dir.is_dir() {
        return Err(ErrorResponse::bad_request(format!(
            "GOOSE_DISTRO_DIR points to a non-directory path: {}",
            root_dir.display()
        )));
    }

    let manifest_path = root_dir.join("distro.json");
    if !manifest_path.exists() {
        return Ok(Json(DistroBundleInfo {
            present: false,
            app_version: None,
            feature_toggles: None,
            extension_allowlist: None,
            provider_allowlist: None,
        }));
    }

    let manifest = read_manifest(&manifest_path)?;

    Ok(Json(DistroBundleInfo {
        present: true,
        app_version: manifest.app_version,
        feature_toggles: manifest.feature_toggles,
        extension_allowlist: manifest.extension_allowlist,
        provider_allowlist: manifest.provider_allowlist,
    }))
}

pub fn routes() -> Router {
    Router::new()
        .route("/doctor/run", post(run_doctor))
        .route("/doctor/fix", post(run_doctor_fix))
        .route("/doctor/distro", get(get_distro_bundle))
}
