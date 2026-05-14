use axum::extract::Query;
use axum::routing::{get, post};
use axum::{Json, Router};
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::{Path as StdPath, PathBuf};

use crate::serve::errors::ErrorResponse;

const DEFAULT_FILE_MENTION_LIMIT: usize = 1500;
const MAX_FILE_MENTION_LIMIT: usize = 5000;
const MAX_SCAN_DEPTH: usize = 8;
const MAX_IMAGE_ATTACHMENT_BYTES: u64 = 20 * 1024 * 1024;
const MAX_ICON_CANDIDATES: usize = 18;
const MAX_PROJECT_ICON_BYTES: u64 = 512 * 1024;

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileTreeEntry {
    pub name: String,
    pub path: String,
    pub kind: String,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentPathInfo {
    pub name: String,
    pub path: String,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ImageAttachmentPayload {
    pub base64: String,
    pub mime_type: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PathQuery {
    path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListFilesRequest {
    roots: Vec<String>,
    max_results: Option<usize>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ListFilesResponse {
    files: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct InspectPathsRequest {
    paths: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct InspectPathsResponse {
    attachments: Vec<AttachmentPathInfo>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResolvePathRequest {
    parts: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ResolvePathResponse {
    path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HomeDirResponse {
    path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PathExistsResponse {
    exists: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScanProjectIconsRequest {
    working_dirs: Vec<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProjectIconCandidate {
    pub id: String,
    pub label: String,
    pub icon: String,
    pub source_dir: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProjectIconData {
    pub icon: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ScanProjectIconsResponse {
    icons: Vec<ProjectIconCandidate>,
}

fn working_root() -> Result<PathBuf, ErrorResponse> {
    let raw = std::env::var("GOOSE_SERVE__WORKING_ROOT")
        .or_else(|_| std::env::var("GOOSE_SERVER__WORKING_ROOT"))
        .unwrap_or_else(|_| ".".to_string());
    let root = PathBuf::from(raw);
    if !root.is_dir() {
        return Err(ErrorResponse::bad_request(
            "Goose serve working root must be an existing directory",
        ));
    }
    root.canonicalize().map_err(|error| {
        ErrorResponse::internal(format!(
            "Failed to resolve working root '{}': {}",
            root.display(),
            error
        ))
    })
}

fn forbidden_path(path: &StdPath) -> ErrorResponse {
    ErrorResponse {
        message: format!("Path escapes working root: {}", path.display()),
        status: axum::http::StatusCode::FORBIDDEN,
    }
}

fn canonical_existing_ancestor(path: &StdPath) -> Option<PathBuf> {
    let mut cursor = path;
    loop {
        if cursor.exists() {
            return cursor.canonicalize().ok();
        }
        let parent = cursor.parent()?;
        cursor = parent;
    }
}

pub(crate) fn resolve_path_within_working_root(raw_path: &str) -> Result<PathBuf, ErrorResponse> {
    let root = working_root()?;
    let trimmed = raw_path.trim();
    if trimmed.is_empty() {
        return Err(ErrorResponse::bad_request("Path cannot be empty"));
    }

    let candidate = PathBuf::from(trimmed);
    let absolute = if candidate.is_absolute() {
        candidate
    } else {
        root.join(candidate)
    };

    let check_target = if absolute.exists() {
        absolute.canonicalize().map_err(|error| {
            ErrorResponse::internal(format!(
                "Failed to resolve path '{}': {}",
                absolute.display(),
                error
            ))
        })?
    } else {
        canonical_existing_ancestor(&absolute)
            .ok_or_else(|| ErrorResponse::bad_request("Path has no existing parent"))?
    };

    if !check_target.starts_with(&root) {
        return Err(forbidden_path(&absolute));
    }

    Ok(absolute)
}

fn normalize_path_key(path: &StdPath) -> String {
    if let Ok(canonical) = path.canonicalize() {
        return canonical.to_string_lossy().into_owned();
    }

    let raw = path.to_string_lossy().into_owned();
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    {
        raw.to_lowercase()
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        raw
    }
}

fn normalize_attachment_paths(paths: Vec<String>) -> Vec<PathBuf> {
    let mut seen = HashSet::new();
    let mut normalized = Vec::new();

    for raw_path in paths {
        let trimmed = raw_path.trim();
        if trimmed.is_empty() {
            continue;
        }

        if let Ok(path) = resolve_path_within_working_root(trimmed) {
            let key = normalize_path_key(&path);
            if seen.insert(key) {
                normalized.push(path);
            }
        }
    }

    normalized
}

fn inspect_attachment_path(path: &StdPath) -> Result<AttachmentPathInfo, String> {
    if !path.exists() {
        return Err(format!(
            "Attachment path does not exist: {}",
            path.display()
        ));
    }

    let metadata = fs::metadata(path)
        .map_err(|error| format!("Failed to inspect '{}': {}", path.display(), error))?;
    let name = path
        .file_name()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string_lossy().into_owned());

    Ok(AttachmentPathInfo {
        name,
        path: path.to_string_lossy().into_owned(),
        kind: if metadata.is_dir() {
            "directory".to_string()
        } else {
            "file".to_string()
        },
        mime_type: if metadata.is_file() {
            mime_guess::from_path(path)
                .first_raw()
                .map(std::borrow::ToOwned::to_owned)
        } else {
            None
        },
    })
}

fn read_directory_entries(path: &StdPath) -> Result<Vec<FileTreeEntry>, String> {
    if !path.exists() {
        return Err(format!("Directory does not exist: {}", path.display()));
    }

    let metadata = fs::metadata(path)
        .map_err(|error| format!("Failed to inspect '{}': {}", path.display(), error))?;
    if !metadata.is_dir() {
        return Err(format!("Path is not a directory: {}", path.display()));
    }

    let mut entries = Vec::new();
    let reader = fs::read_dir(path)
        .map_err(|error| format!("Failed to read directory '{}': {}", path.display(), error))?;

    for entry in reader {
        let Ok(entry) = entry else {
            continue;
        };
        let name = entry.file_name().to_string_lossy().into_owned();
        if name == ".git" {
            continue;
        }
        let metadata = match fs::symlink_metadata(entry.path()) {
            Ok(m) => m,
            Err(_) => continue,
        };
        let file_type = metadata.file_type();
        entries.push(FileTreeEntry {
            name,
            path: entry.path().to_string_lossy().into_owned(),
            kind: if file_type.is_dir() {
                "directory".to_string()
            } else {
                "file".to_string()
            },
        });
    }

    entries.sort_by(|a, b| {
        let a_rank = if a.kind == "directory" { 0 } else { 1 };
        let b_rank = if b.kind == "directory" { 0 } else { 1 };
        a_rank
            .cmp(&b_rank)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
            .then_with(|| a.name.cmp(&b.name))
    });

    Ok(entries)
}

fn normalize_roots(roots: Vec<String>) -> Vec<PathBuf> {
    let mut dedup = HashSet::new();
    let mut normalized = Vec::new();
    for root in roots {
        let trimmed = root.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Ok(path) = resolve_path_within_working_root(trimmed) else {
            continue;
        };
        let key = normalize_path_key(&path);
        if dedup.insert(key) {
            normalized.push(path);
        }
    }
    normalized
}

fn scan_files_for_mentions(roots: Vec<String>, max_results: Option<usize>) -> Vec<String> {
    let roots = normalize_roots(roots);
    if roots.is_empty() {
        return Vec::new();
    }

    let limit = max_results
        .unwrap_or(DEFAULT_FILE_MENTION_LIMIT)
        .clamp(1, MAX_FILE_MENTION_LIMIT);

    let mut builder = ignore::WalkBuilder::new(&roots[0]);
    for root in &roots[1..] {
        builder.add(root);
    }
    builder
        .max_depth(Some(MAX_SCAN_DEPTH))
        .follow_links(false)
        .hidden(true)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true);

    let canonical_roots: Vec<PathBuf> = roots
        .iter()
        .filter_map(|root| root.canonicalize().ok())
        .collect();

    let mut seen = HashSet::new();
    let mut files = Vec::new();

    for entry in builder.build().flatten() {
        if files.len() >= limit {
            break;
        }
        let Some(ft) = entry.file_type() else {
            continue;
        };
        if !ft.is_file() {
            continue;
        }

        let canonical = match entry.path().canonicalize() {
            Ok(c) => c,
            Err(_) => continue,
        };
        if !canonical_roots
            .iter()
            .any(|root| canonical.starts_with(root))
        {
            continue;
        }

        let path_str = entry.path().to_string_lossy().to_string();
        let dedup_key = normalize_path_key(entry.path());
        if seen.insert(dedup_key) {
            files.push(path_str);
        }
    }

    files.sort_by_key(|path| path.to_lowercase());
    files
}

fn trim_part(part: &str) -> Option<&str> {
    let trimmed = part.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

fn expand_home_prefix(part: &str) -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    match part {
        "~" => Some(home),
        _ => part
            .strip_prefix("~/")
            .or_else(|| part.strip_prefix("~\\"))
            .map(|relative| home.join(relative)),
    }
}

fn resolve_path_parts(parts: Vec<String>) -> Result<String, String> {
    let mut normalized_parts = parts.iter().filter_map(|part| trim_part(part)).peekable();

    let first = normalized_parts
        .next()
        .ok_or_else(|| "Path parts must include at least one non-empty segment".to_string())?;
    let mut path = expand_home_prefix(first).unwrap_or_else(|| PathBuf::from(first));

    for part in normalized_parts {
        path.push(part);
    }

    Ok(path.to_string_lossy().into_owned())
}

struct ScoredProjectIconPath {
    score: i32,
    path: PathBuf,
    path_string: String,
    label: String,
    source_dir: String,
    group_key: String,
}

fn is_project_icon_extension(path: &StdPath) -> bool {
    matches!(
        path.extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.to_ascii_lowercase())
            .as_deref(),
        Some("svg" | "png" | "ico" | "jpg" | "jpeg" | "webp")
    )
}

fn is_ignored_icon_search_dir(root: &StdPath, path: &StdPath) -> bool {
    let relative_parent = path
        .strip_prefix(root)
        .unwrap_or(path)
        .parent()
        .unwrap_or_else(|| StdPath::new(""));

    relative_parent.components().any(|component| {
        let name = component.as_os_str().to_string_lossy().to_ascii_lowercase();
        matches!(
            name.as_str(),
            "node_modules" | "target" | "dist" | "build" | ".git" | ".next" | ".turbo"
        )
    })
}

fn is_generated_icon_variant(path: &StdPath) -> bool {
    let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
        return false;
    };
    let normalized = file_name.to_ascii_lowercase();
    let stem = path
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let mostly_size_token = stem
        .chars()
        .all(|c| c.is_ascii_digit() || matches!(c, 'x' | '@' | '-' | '_'));

    normalized.starts_with("appicon-")
        || normalized.starts_with("square")
        || normalized.starts_with("storelogo")
        || normalized.contains("template")
        || normalized.contains("@2x")
        || normalized.contains("@3x")
        || mostly_size_token
        || stem
            .strip_prefix("icon-")
            .is_some_and(|suffix| suffix.chars().all(|c| c.is_ascii_digit()))
        || stem
            .strip_prefix("icon@")
            .is_some_and(|suffix| suffix.ends_with('x'))
}

fn is_likely_project_icon(path: &StdPath) -> bool {
    let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
        return false;
    };
    let normalized = file_name.to_ascii_lowercase();
    normalized == "favicon.ico"
        || normalized == "favicon.svg"
        || normalized == "favicon.png"
        || normalized.starts_with("apple-touch-icon")
        || normalized.starts_with("mstile-")
        || normalized.contains("logo")
        || normalized.contains("brand")
        || normalized.contains("wordmark")
        || normalized.contains("app-icon")
        || normalized.contains("appicon")
        || normalized.contains("icon")
}

fn project_icon_score(root: &StdPath, path: &StdPath) -> i32 {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let relative = path
        .strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .to_ascii_lowercase();

    let mut score = 100;
    if file_name.starts_with("favicon") {
        score -= 35;
    }
    if file_name.contains("logo") {
        score -= 30;
    }
    if file_name.contains("brand") || file_name.contains("wordmark") {
        score -= 25;
    }
    if relative.starts_with("public/")
        || relative.starts_with("static/")
        || relative.starts_with("assets/")
        || relative.starts_with("src/assets/")
        || relative.starts_with("src/images/")
    {
        score -= 20;
    }
    score + relative.matches('/').count() as i32
}

fn project_icon_group_key(path: &StdPath) -> String {
    let file_stem = path
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let normalized = file_stem
        .replace("goose-logo", "logo")
        .replace("logo-codename-goose", "logo")
        .replace("codename-goose", "logo");

    if normalized.contains("favicon") {
        "favicon".to_string()
    } else if normalized.contains("wordmark") {
        "wordmark".to_string()
    } else if normalized.contains("brand") {
        "brand".to_string()
    } else if normalized.contains("logo") {
        "logo".to_string()
    } else if normalized.contains("app-icon") || normalized.contains("appicon") {
        "app-icon".to_string()
    } else {
        normalized
    }
}

fn project_icon_root_key(root: &StdPath) -> String {
    root.to_string_lossy().into_owned()
}

fn project_icon_candidate_group_key(root: &StdPath, path: &StdPath) -> String {
    format!(
        "{}:{}",
        project_icon_root_key(root),
        project_icon_group_key(path)
    )
}

fn read_project_icon_data_url(path: &StdPath) -> Result<String, String> {
    let metadata = fs::metadata(path).map_err(|e| format!("Failed to inspect icon: {}", e))?;
    if !metadata.is_file() {
        return Err("Icon path is not a file".to_string());
    }
    if metadata.len() > MAX_PROJECT_ICON_BYTES {
        return Err("Icon file is too large".to_string());
    }

    let mime = mime_guess::from_path(path)
        .first_or_octet_stream()
        .essence_str()
        .to_string();
    if !matches!(
        mime.as_str(),
        "image/svg+xml"
            | "image/png"
            | "image/x-icon"
            | "image/vnd.microsoft.icon"
            | "image/jpeg"
            | "image/webp"
    ) {
        return Err("Icon file type is not supported".to_string());
    }

    let bytes = fs::read(path).map_err(|e| format!("Failed to read icon: {}", e))?;
    Ok(format!(
        "data:{};base64,{}",
        mime,
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

fn scan_project_icons_internal(working_dirs: Vec<String>) -> Vec<ProjectIconCandidate> {
    let mut candidates: Vec<ScoredProjectIconPath> = Vec::new();
    let mut seen = HashSet::new();

    for dir in working_dirs {
        let Ok(root) = resolve_path_within_working_root(dir.trim()) else {
            continue;
        };
        if !root.is_dir() {
            continue;
        }

        let source_dir = root
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("project")
            .to_string();

        let walker = ignore::WalkBuilder::new(&root)
            .max_depth(Some(6))
            .standard_filters(true)
            .build();

        for entry in walker.flatten() {
            let path = entry.path();
            if !path.is_file()
                || is_ignored_icon_search_dir(&root, path)
                || is_generated_icon_variant(path)
                || !is_project_icon_extension(path)
                || !is_likely_project_icon(path)
            {
                continue;
            }

            let path_string = path.to_string_lossy().into_owned();
            if !seen.insert(path_string.clone()) {
                continue;
            }

            let relative = path.strip_prefix(&root).unwrap_or(path);
            let label = relative.to_string_lossy().into_owned();
            let score = project_icon_score(&root, path);
            let group_key = project_icon_candidate_group_key(&root, path);
            candidates.push(ScoredProjectIconPath {
                score,
                path: path.to_path_buf(),
                path_string,
                label,
                source_dir: source_dir.clone(),
                group_key,
            });
        }
    }

    candidates.sort_by(|a, b| a.score.cmp(&b.score).then_with(|| a.label.cmp(&b.label)));

    let mut seen_groups = HashSet::new();
    let mut icons = Vec::new();
    for candidate in candidates {
        if icons.len() >= MAX_ICON_CANDIDATES {
            break;
        }
        if seen_groups.contains(&candidate.group_key) {
            continue;
        }
        let icon = match read_project_icon_data_url(&candidate.path) {
            Ok(icon) => icon,
            Err(_) => continue,
        };
        seen_groups.insert(candidate.group_key);
        icons.push(ProjectIconCandidate {
            id: candidate.path_string,
            label: candidate.label,
            icon,
            source_dir: candidate.source_dir,
        });
    }

    icons
}

async fn get_home_dir() -> Result<Json<HomeDirResponse>, ErrorResponse> {
    let home_dir = dirs::home_dir()
        .ok_or_else(|| ErrorResponse::internal("Could not determine home directory"))?;
    Ok(Json(HomeDirResponse {
        path: home_dir.to_string_lossy().into_owned(),
    }))
}

async fn path_exists(
    Query(query): Query<PathQuery>,
) -> Result<Json<PathExistsResponse>, ErrorResponse> {
    let path = resolve_path_within_working_root(&query.path)?;
    Ok(Json(PathExistsResponse {
        exists: path.exists(),
    }))
}

async fn list_files_for_mentions(
    Json(request): Json<ListFilesRequest>,
) -> Result<Json<ListFilesResponse>, ErrorResponse> {
    let files = tokio::task::spawn_blocking(move || {
        scan_files_for_mentions(request.roots, request.max_results)
    })
    .await
    .map_err(|error| {
        ErrorResponse::internal(format!("Failed to scan files for mentions: {}", error))
    })?;

    Ok(Json(ListFilesResponse { files }))
}

async fn list_directory_entries(
    Query(query): Query<PathQuery>,
) -> Result<Json<Vec<FileTreeEntry>>, ErrorResponse> {
    let path = resolve_path_within_working_root(&query.path)?;
    let entries = read_directory_entries(&path)
        .map_err(|error| ErrorResponse::bad_request(error.to_string()))?;
    Ok(Json(entries))
}

async fn inspect_attachment_paths(
    Json(request): Json<InspectPathsRequest>,
) -> Result<Json<InspectPathsResponse>, ErrorResponse> {
    let attachments = normalize_attachment_paths(request.paths)
        .into_iter()
        .filter_map(|path| inspect_attachment_path(&path).ok())
        .collect();

    Ok(Json(InspectPathsResponse { attachments }))
}

async fn read_image_attachment(
    Query(query): Query<PathQuery>,
) -> Result<Json<ImageAttachmentPayload>, ErrorResponse> {
    let path = resolve_path_within_working_root(&query.path)?;
    let attachment = inspect_attachment_path(&path).map_err(ErrorResponse::bad_request)?;
    let mime_type = attachment.mime_type.ok_or_else(|| {
        ErrorResponse::bad_request(format!(
            "Unable to determine image type for '{}'",
            attachment.path
        ))
    })?;

    if !mime_type.starts_with("image/") {
        return Err(ErrorResponse::bad_request(format!(
            "Attachment is not an image: {}",
            attachment.path
        )));
    }

    let metadata = fs::metadata(&attachment.path).map_err(|error| {
        ErrorResponse::bad_request(format!(
            "Failed to inspect image '{}': {}",
            attachment.path, error
        ))
    })?;
    if metadata.len() > MAX_IMAGE_ATTACHMENT_BYTES {
        return Err(ErrorResponse::bad_request(format!(
            "Image attachment '{}' exceeds the {} MB limit",
            attachment.path,
            MAX_IMAGE_ATTACHMENT_BYTES / (1024 * 1024)
        )));
    }

    let bytes = fs::read(&attachment.path).map_err(|error| {
        ErrorResponse::bad_request(format!(
            "Failed to read image '{}': {}",
            attachment.path, error
        ))
    })?;

    Ok(Json(ImageAttachmentPayload {
        base64: base64::engine::general_purpose::STANDARD.encode(bytes),
        mime_type,
    }))
}

async fn resolve_path(
    Json(request): Json<ResolvePathRequest>,
) -> Result<Json<ResolvePathResponse>, ErrorResponse> {
    let path = resolve_path_parts(request.parts).map_err(ErrorResponse::bad_request)?;
    Ok(Json(ResolvePathResponse { path }))
}

async fn scan_project_icons(
    Json(request): Json<ScanProjectIconsRequest>,
) -> Result<Json<ScanProjectIconsResponse>, ErrorResponse> {
    let icons =
        tokio::task::spawn_blocking(move || scan_project_icons_internal(request.working_dirs))
            .await
            .map_err(|error| {
                ErrorResponse::internal(format!("Failed to scan project icons: {}", error))
            })?;
    Ok(Json(ScanProjectIconsResponse { icons }))
}

async fn read_project_icon(
    Query(query): Query<PathQuery>,
) -> Result<Json<ProjectIconData>, ErrorResponse> {
    let path = resolve_path_within_working_root(&query.path)?;
    if !is_project_icon_extension(&path) {
        return Err(ErrorResponse::bad_request(
            "Icon file type is not supported",
        ));
    }
    let icon = read_project_icon_data_url(&path).map_err(ErrorResponse::bad_request)?;
    Ok(Json(ProjectIconData { icon }))
}

pub fn routes() -> Router {
    Router::new()
        .route("/fs/home-dir", get(get_home_dir))
        .route("/fs/path-exists", get(path_exists))
        .route("/fs/list-files-for-mentions", post(list_files_for_mentions))
        .route("/fs/list-directory-entries", get(list_directory_entries))
        .route(
            "/fs/inspect-attachment-paths",
            post(inspect_attachment_paths),
        )
        .route("/fs/read-image-attachment", get(read_image_attachment))
        .route("/fs/resolve-path", post(resolve_path))
        .route("/fs/project-icons/scan", post(scan_project_icons))
        .route("/fs/project-icons/read", get(read_project_icon))
}

#[cfg(test)]
mod tests {
    use super::resolve_path_within_working_root;

    #[test]
    fn blocks_paths_outside_root() {
        let root = tempfile::tempdir().expect("tempdir");
        std::env::set_var("GOOSE_SERVE__WORKING_ROOT", root.path());

        let result = resolve_path_within_working_root("/etc/passwd");
        assert!(result.is_err());
        let error = result.expect_err("should fail");
        assert_eq!(error.status, axum::http::StatusCode::FORBIDDEN);
    }
}
