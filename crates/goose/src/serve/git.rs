use axum::extract::Query;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command;

use crate::serve::errors::ErrorResponse;
use crate::serve::filesystem::resolve_path_within_working_root;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitState {
    pub is_git_repo: bool,
    pub current_branch: Option<String>,
    pub dirty_file_count: u32,
    pub incoming_commit_count: u32,
    pub worktrees: Vec<WorktreeInfo>,
    pub is_worktree: bool,
    pub main_worktree_path: Option<String>,
    pub local_branches: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeInfo {
    pub path: String,
    pub branch: Option<String>,
    pub is_main: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedWorktree {
    pub path: String,
    pub branch: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangedFile {
    pub path: String,
    pub status: String,
    pub additions: u32,
    pub deletions: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitPathQuery {
    path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitSwitchRequest {
    path: String,
    branch: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitPathRequest {
    path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitCreateBranchRequest {
    path: String,
    name: String,
    base_branch: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitCreateWorktreeRequest {
    path: String,
    name: String,
    branch: String,
    create_branch: bool,
    base_branch: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ChangedFilesResponse {
    files: Vec<ChangedFile>,
}

const ALLOWED_GIT_COMMANDS: &[&str] = &[
    "init",
    "status",
    "log",
    "branch",
    "fetch",
    "pull",
    "stash",
    "switch",
    "rev-parse",
    "worktree",
    "diff",
    "rev-list",
];

fn is_git_command_allowed(args: &[&str]) -> bool {
    args.first()
        .map(|command| ALLOWED_GIT_COMMANDS.contains(command))
        .unwrap_or(false)
}

fn resolve_repo_path(path: &str) -> Result<PathBuf, ErrorResponse> {
    let repo_path = resolve_path_within_working_root(path)?;
    if !repo_path.exists() {
        return Err(ErrorResponse::bad_request(format!(
            "Path does not exist: {}",
            repo_path.display()
        )));
    }
    Ok(repo_path)
}

fn run_git_success(path: &Path, args: &[&str]) -> Result<String, ErrorResponse> {
    if !is_git_command_allowed(args) {
        return Err(ErrorResponse::bad_request(format!(
            "git {} is not allowed",
            args.join(" ")
        )));
    }

    let output = Command::new("git")
        .args(args)
        .current_dir(path)
        .output()
        .map_err(|error| ErrorResponse::internal(format!("Failed to run git: {}", error)))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let message = if !stderr.is_empty() { stderr } else { stdout };
        let rendered_args = args.join(" ");
        return Err(ErrorResponse::bad_request(format!(
            "git {} failed: {}",
            rendered_args, message
        )));
    }

    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

fn is_git_repo(path: &Path) -> Result<bool, ErrorResponse> {
    let output = Command::new("git")
        .arg("rev-parse")
        .arg("--is-inside-work-tree")
        .current_dir(path)
        .output()
        .map_err(|error| ErrorResponse::internal(format!("Failed to run git: {}", error)))?;

    Ok(output.status.success() && String::from_utf8_lossy(&output.stdout).trim() == "true")
}

fn trim_to_option(value: String) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn require_nonempty(value: &str, label: &str) -> Result<String, ErrorResponse> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        Err(ErrorResponse::bad_request(format!(
            "{} cannot be empty",
            label
        )))
    } else {
        Ok(trimmed.to_string())
    }
}

fn validate_branch_name(branch: &str, label: &str) -> Result<String, ErrorResponse> {
    let branch = require_nonempty(branch, label)?;
    if branch.contains(['/', '\\']) {
        return Err(ErrorResponse::bad_request(format!(
            "{} cannot contain path separators",
            label
        )));
    }
    Ok(branch)
}

fn count_lines(value: &str) -> u32 {
    value
        .lines()
        .filter(|line| !line.trim().is_empty())
        .count()
        .try_into()
        .unwrap_or(u32::MAX)
}

fn resolve_main_worktree_path(git_common_dir: &str, current_root: &str) -> Option<String> {
    let current_root_path = Path::new(current_root);
    let common_dir_path = Path::new(git_common_dir);

    let absolute_common_dir = if common_dir_path.is_absolute() {
        common_dir_path.to_path_buf()
    } else {
        current_root_path.join(common_dir_path)
    };

    let repo_dir = if absolute_common_dir
        .file_name()
        .is_some_and(|name| name == ".git")
    {
        absolute_common_dir
    } else {
        absolute_common_dir.parent().map(Path::to_path_buf)?
    };

    Some(repo_dir.to_string_lossy().to_string())
}

fn parse_worktrees(output: &str, main_path: Option<&str>) -> Vec<WorktreeInfo> {
    let mut worktrees = Vec::new();
    let mut current_path: Option<String> = None;
    let mut current_branch: Option<String> = None;

    for line in output.lines() {
        if let Some(path) = line.strip_prefix("worktree ") {
            if let Some(path) = current_path.take() {
                worktrees.push(WorktreeInfo {
                    is_main: main_path.is_some_and(|main| normalize_path_string(&path) == main),
                    path: normalize_path_string(&path),
                    branch: current_branch.take(),
                });
            }

            current_path = Some(path.trim().to_string());
            current_branch = None;
            continue;
        }

        if let Some(branch) = line.strip_prefix("branch refs/heads/") {
            current_branch = Some(branch.trim().to_string());
            continue;
        }
    }

    if let Some(path) = current_path {
        worktrees.push(WorktreeInfo {
            is_main: main_path.is_some_and(|main| normalize_path_string(&path) == main),
            path: normalize_path_string(&path),
            branch: current_branch,
        });
    }

    worktrees
}

fn normalize_path_string(path: &str) -> String {
    PathBuf::from(path)
        .canonicalize()
        .unwrap_or_else(|_| PathBuf::from(path))
        .to_string_lossy()
        .to_string()
}

fn list_local_branches(path: &Path) -> Result<Vec<String>, ErrorResponse> {
    let output = run_git_success(path, &["branch", "--format", "%(refname:short)"])?;
    let mut branches = output
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(ToString::to_string)
        .collect::<Vec<_>>();
    branches.sort();
    Ok(branches)
}

fn count_incoming_commits(path: &Path) -> Result<u32, ErrorResponse> {
    let has_upstream = Command::new("git")
        .arg("rev-parse")
        .arg("--abbrev-ref")
        .arg("--symbolic-full-name")
        .arg("@{u}")
        .current_dir(path)
        .output()
        .map_err(|error| ErrorResponse::internal(format!("Failed to run git: {}", error)))?;

    if !has_upstream.status.success() {
        return Ok(0);
    }

    let count_output = run_git_success(path, &["rev-list", "--count", "HEAD..@{u}"])?;

    Ok(count_output.trim().parse::<u32>().unwrap_or(0))
}

fn validate_worktree_name(name: &str) -> Result<String, ErrorResponse> {
    let trimmed = require_nonempty(name, "Worktree name")?;
    if trimmed.contains(['/', '\\']) {
        return Err(ErrorResponse::bad_request(
            "Worktree name cannot contain path separators",
        ));
    }
    Ok(trimmed)
}

fn derive_worktree_path(base_path: &str, worktree_name: &str) -> Result<PathBuf, ErrorResponse> {
    let base = resolve_path_within_working_root(base_path)?;
    let parent = base.parent().unwrap_or(&base);
    let target = parent.join(worktree_name);
    let _ = resolve_path_within_working_root(target.to_string_lossy().as_ref())?;
    Ok(target)
}

fn parse_status_codes(index: u8, worktree: u8) -> String {
    if index == b'?' && worktree == b'?' {
        return "untracked".to_string();
    }
    if index == b'A' || (index == b'?' && worktree != b'?') {
        return "added".to_string();
    }
    if index == b'D' || worktree == b'D' {
        return "deleted".to_string();
    }
    if index == b'R' {
        return "renamed".to_string();
    }
    if index == b'C' {
        return "copied".to_string();
    }
    "modified".to_string()
}

fn parse_numstat(output: &str) -> std::collections::HashMap<String, (u32, u32)> {
    let mut map = std::collections::HashMap::new();
    for line in output.lines() {
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() >= 3 {
            let additions = parts[0].parse::<u32>().unwrap_or(0);
            let deletions = parts[1].parse::<u32>().unwrap_or(0);
            let path = parts[2..].join("\t");
            map.insert(expand_rename_path(&path), (additions, deletions));
        }
    }
    map
}

fn unquote_porcelain(s: &str) -> String {
    if s.starts_with('"') && s.ends_with('"') && s.len() >= 2 {
        s[1..s.len() - 1].to_string()
    } else {
        s.to_string()
    }
}

fn expand_rename_path(path: &str) -> String {
    if let Some(brace_start) = path.find('{') {
        if let Some(brace_end) = path.find('}') {
            let prefix = &path[..brace_start];
            let inner = &path[brace_start + 1..brace_end];
            let suffix = &path[brace_end + 1..];
            let new_name = inner.split(" => ").last().unwrap_or(inner);
            return format!("{}{}{}", prefix, new_name, suffix);
        }
    }
    if path.contains(" => ") {
        path.split(" => ").last().unwrap_or(path).to_string()
    } else {
        path.to_string()
    }
}

const MAX_LINE_COUNT_SIZE: u64 = 1024 * 1024;

fn count_file_lines(repo_path: &Path, file_path: &str) -> (u32, u32) {
    let full = repo_path.join(file_path);
    let meta = match std::fs::metadata(&full) {
        Ok(m) => m,
        Err(_) => return (0, 0),
    };
    if meta.len() > MAX_LINE_COUNT_SIZE {
        return (0, 0);
    }
    match std::fs::read_to_string(&full) {
        Ok(contents) => {
            let count = contents.lines().count() as u32;
            (count, 0)
        }
        Err(_) => (0, 0),
    }
}

fn get_changed_files_internal(repo_path: &Path) -> Result<Vec<ChangedFile>, ErrorResponse> {
    if !is_git_repo(repo_path)? {
        return Ok(Vec::new());
    }

    let status_output = run_git_success(
        repo_path,
        &["status", "--porcelain", "--untracked-files=all"],
    )?;
    if status_output.trim().is_empty() {
        return Ok(Vec::new());
    }

    let head_numstat =
        run_git_success(repo_path, &["diff", "HEAD", "--numstat"]).unwrap_or_default();
    let head_stats = parse_numstat(&head_numstat);

    let mut files: Vec<ChangedFile> = Vec::new();

    for line in status_output.lines() {
        if line.len() < 4 {
            continue;
        }

        let index_status = line.as_bytes()[0];
        let worktree_status = line.as_bytes()[1];
        let file_path = unquote_porcelain(line[3..].trim());
        let file_path = if file_path.contains(" -> ") {
            file_path
                .split(" -> ")
                .last()
                .unwrap_or(&file_path)
                .to_string()
        } else {
            file_path
        };

        let status = parse_status_codes(index_status, worktree_status);

        let (additions, deletions) = head_stats
            .get(&file_path)
            .copied()
            .unwrap_or_else(|| count_file_lines(repo_path, &file_path));

        files.push(ChangedFile {
            path: file_path,
            status,
            additions,
            deletions,
        });
    }

    files.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(files)
}

async fn get_git_state(Query(query): Query<GitPathQuery>) -> Result<Json<GitState>, ErrorResponse> {
    let repo_path = resolve_repo_path(&query.path)?;

    if !is_git_repo(&repo_path)? {
        return Ok(Json(GitState {
            is_git_repo: false,
            current_branch: None,
            dirty_file_count: 0,
            incoming_commit_count: 0,
            worktrees: Vec::new(),
            is_worktree: false,
            main_worktree_path: None,
            local_branches: Vec::new(),
        }));
    }

    let current_root = trim_to_option(run_git_success(
        &repo_path,
        &["rev-parse", "--show-toplevel"],
    )?)
    .ok_or_else(|| ErrorResponse::internal("Could not determine repository root"))?;
    let current_branch =
        trim_to_option(run_git_success(&repo_path, &["branch", "--show-current"])?);
    let dirty_file_count = count_lines(&run_git_success(&repo_path, &["status", "--porcelain"])?);
    let git_common_dir = trim_to_option(run_git_success(
        &repo_path,
        &["rev-parse", "--git-common-dir"],
    )?);
    let main_worktree_path = git_common_dir
        .as_deref()
        .and_then(|git_common_dir| resolve_main_worktree_path(git_common_dir, &current_root))
        .as_deref()
        .map(normalize_path_string);
    let worktrees_output = run_git_success(&repo_path, &["worktree", "list", "--porcelain"])?;
    let worktrees = parse_worktrees(&worktrees_output, main_worktree_path.as_deref());
    let is_worktree = main_worktree_path
        .as_deref()
        .map(|main_path| normalize_path_string(&current_root) != main_path)
        .unwrap_or(false);
    let incoming_commit_count = count_incoming_commits(&repo_path).unwrap_or(0);

    let local_branches = list_local_branches(&repo_path).unwrap_or_default();

    Ok(Json(GitState {
        is_git_repo: true,
        current_branch,
        dirty_file_count,
        incoming_commit_count,
        worktrees,
        is_worktree,
        main_worktree_path,
        local_branches,
    }))
}

async fn switch_branch(
    Json(request): Json<GitSwitchRequest>,
) -> Result<Json<serde_json::Value>, ErrorResponse> {
    let repo_path = resolve_repo_path(&request.path)?;
    let branch = validate_branch_name(&request.branch, "Branch name")?;
    run_git_success(&repo_path, &["switch", branch.as_str()])?;
    Ok(Json(serde_json::json!({"ok": true})))
}

async fn git_stash(
    Json(request): Json<GitPathRequest>,
) -> Result<Json<serde_json::Value>, ErrorResponse> {
    let repo_path = resolve_repo_path(&request.path)?;
    run_git_success(&repo_path, &["stash"])?;
    Ok(Json(serde_json::json!({"ok": true})))
}

async fn git_init(
    Json(request): Json<GitPathRequest>,
) -> Result<Json<serde_json::Value>, ErrorResponse> {
    let repo_path = resolve_repo_path(&request.path)?;
    run_git_success(&repo_path, &["init"])?;
    Ok(Json(serde_json::json!({"ok": true})))
}

async fn git_fetch(
    Json(request): Json<GitPathRequest>,
) -> Result<Json<serde_json::Value>, ErrorResponse> {
    let repo_path = resolve_repo_path(&request.path)?;
    run_git_success(&repo_path, &["fetch", "--prune"])?;
    Ok(Json(serde_json::json!({"ok": true})))
}

async fn git_pull(
    Json(request): Json<GitPathRequest>,
) -> Result<Json<serde_json::Value>, ErrorResponse> {
    let repo_path = resolve_repo_path(&request.path)?;
    run_git_success(&repo_path, &["pull", "--ff-only"])?;
    Ok(Json(serde_json::json!({"ok": true})))
}

async fn git_create_branch(
    Json(request): Json<GitCreateBranchRequest>,
) -> Result<Json<serde_json::Value>, ErrorResponse> {
    let repo_path = resolve_repo_path(&request.path)?;
    let branch_name = validate_branch_name(&request.name, "Branch name")?;
    let base_branch = validate_branch_name(&request.base_branch, "Base branch")?;
    run_git_success(
        &repo_path,
        &["switch", "-c", branch_name.as_str(), base_branch.as_str()],
    )?;
    Ok(Json(serde_json::json!({"ok": true})))
}

async fn get_changed_files(
    Query(query): Query<GitPathQuery>,
) -> Result<Json<ChangedFilesResponse>, ErrorResponse> {
    let repo_path = resolve_repo_path(&query.path)?;
    let files = get_changed_files_internal(&repo_path)?;
    Ok(Json(ChangedFilesResponse { files }))
}

async fn git_create_worktree(
    Json(request): Json<GitCreateWorktreeRequest>,
) -> Result<Json<CreatedWorktree>, ErrorResponse> {
    let repo_path = resolve_repo_path(&request.path)?;
    let worktree_name = validate_worktree_name(&request.name)?;
    let branch_name = validate_branch_name(&request.branch, "Branch name")?;
    let current_root = trim_to_option(run_git_success(
        &repo_path,
        &["rev-parse", "--show-toplevel"],
    )?)
    .ok_or_else(|| ErrorResponse::internal("Could not determine repository root"))?;
    let git_common_dir = trim_to_option(run_git_success(
        &repo_path,
        &["rev-parse", "--git-common-dir"],
    )?);
    let main_worktree_path = git_common_dir
        .as_deref()
        .and_then(|git_common_dir| resolve_main_worktree_path(git_common_dir, &current_root));

    let target_path = derive_worktree_path(
        main_worktree_path
            .as_deref()
            .unwrap_or(request.path.as_str()),
        &worktree_name,
    )?;

    if let Some(parent) = target_path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| {
            ErrorResponse::internal(format!("Failed to create worktree directory: {}", error))
        })?;
    }

    let target_path_string = target_path.to_string_lossy().to_string();

    if request.create_branch {
        let base_branch = require_nonempty(
            request.base_branch.as_deref().unwrap_or_default(),
            "Base branch",
        )?;
        let base_branch = validate_branch_name(&base_branch, "Base branch")?;
        run_git_success(
            &repo_path,
            &[
                "worktree",
                "add",
                "-b",
                branch_name.as_str(),
                target_path_string.as_str(),
                base_branch.as_str(),
            ],
        )?;
    } else {
        run_git_success(
            &repo_path,
            &[
                "worktree",
                "add",
                target_path_string.as_str(),
                branch_name.as_str(),
            ],
        )?;
    }

    Ok(Json(CreatedWorktree {
        path: normalize_path_string(&target_path_string),
        branch: branch_name,
    }))
}

pub fn routes() -> Router {
    Router::new()
        .route("/git/state", get(get_git_state))
        .route("/git/switch", post(switch_branch))
        .route("/git/stash", post(git_stash))
        .route("/git/init", post(git_init))
        .route("/git/fetch", post(git_fetch))
        .route("/git/pull", post(git_pull))
        .route("/git/create-branch", post(git_create_branch))
        .route("/git/changed-files", get(get_changed_files))
        .route("/git/create-worktree", post(git_create_worktree))
}
