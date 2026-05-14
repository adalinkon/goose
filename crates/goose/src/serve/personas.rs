use axum::body::Body;
use axum::extract::{Path, State};
use axum::http::header::CONTENT_TYPE;
use axum::response::IntoResponse;
use axum::routing::{get, post, put};
use axum::{Json, Router};
use serde::{Deserialize, Deserializer, Serialize};
use std::collections::HashSet;
use std::path::{Component, Path as StdPath, PathBuf};
use std::sync::{Arc, Mutex};

use crate::serve::errors::ErrorResponse;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "value")]
pub enum Avatar {
    #[serde(rename = "url")]
    Url(String),
    #[serde(rename = "local")]
    Local(String),
}

fn deserialize_avatar_compat<'de, D>(deserializer: D) -> Result<Option<Avatar>, D::Error>
where
    D: Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum AvatarOrString {
        Avatar(Avatar),
        BareString(String),
    }

    let opt: Option<AvatarOrString> = Option::deserialize(deserializer)?;
    match opt {
        None => Ok(None),
        Some(AvatarOrString::BareString(s)) => {
            if s.is_empty() {
                Ok(None)
            } else {
                Ok(Some(Avatar::Url(s)))
            }
        }
        Some(AvatarOrString::Avatar(a)) => Ok(Some(a)),
    }
}

fn deserialize_avatar_update<'de, D>(deserializer: D) -> Result<Option<Option<Avatar>>, D::Error>
where
    D: Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum AvatarOrString {
        Avatar(Avatar),
        BareString(String),
    }

    let opt: Option<AvatarOrString> = Option::deserialize(deserializer)?;
    match opt {
        None => Ok(Some(None)),
        Some(AvatarOrString::BareString(s)) => {
            if s.is_empty() {
                Ok(Some(None))
            } else {
                Ok(Some(Some(Avatar::Url(s))))
            }
        }
        Some(AvatarOrString::Avatar(a)) => Ok(Some(Some(a))),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Persona {
    pub id: String,
    pub display_name: String,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        alias = "avatarUrl",
        deserialize_with = "deserialize_avatar_compat"
    )]
    pub avatar: Option<Avatar>,
    pub system_prompt: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    pub is_builtin: bool,
    #[serde(default)]
    pub is_from_disk: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatePersonaRequest {
    pub display_name: String,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_avatar_compat"
    )]
    pub avatar: Option<Avatar>,
    pub system_prompt: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePersonaRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_avatar_update"
    )]
    pub avatar: Option<Option<Avatar>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub system_prompt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportResult {
    json: String,
    suggested_filename: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersonaExportV1 {
    version: u32,
    display_name: String,
    system_prompt: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    avatar: Option<Avatar>,
    #[serde(skip_serializing_if = "Option::is_none")]
    provider: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    model: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportRequest {
    file_bytes: Vec<u8>,
    file_name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveAvatarPathRequest {
    persona_id: String,
    source_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveAvatarBytesRequest {
    persona_id: String,
    bytes: Vec<u8>,
    extension: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SaveAvatarResponse {
    filename: String,
}

#[derive(Default)]
struct PersonaStore {
    personas: Mutex<Vec<Persona>>,
    store_path: PathBuf,
}

impl PersonaStore {
    fn new() -> Self {
        let store_path = Self::store_path();
        let stored = Self::load_from_disk(&store_path);
        let markdown = Self::load_markdown_personas();
        let merged = Self::merge_all(stored, markdown);
        Self {
            personas: Mutex::new(merged),
            store_path,
        }
    }

    fn store_path() -> PathBuf {
        let base = dirs::home_dir().expect("home dir");
        base.join(".goose").join("personas.json")
    }

    fn avatars_dir() -> PathBuf {
        dirs::home_dir()
            .expect("home dir")
            .join(".goose")
            .join("avatars")
    }

    fn agents_dir() -> PathBuf {
        dirs::home_dir()
            .expect("home dir")
            .join(".goose")
            .join("agents")
    }

    fn load_from_disk(path: &PathBuf) -> Vec<Persona> {
        match std::fs::read_to_string(path) {
            Ok(contents) => serde_json::from_str(&contents).unwrap_or_default(),
            Err(_) => Vec::new(),
        }
    }

    fn load_markdown_personas() -> Vec<Persona> {
        #[derive(Deserialize)]
        struct MarkdownFrontmatter {
            name: String,
            description: Option<String>,
        }

        let dir = Self::agents_dir();
        if !dir.is_dir() {
            return Vec::new();
        }

        let mut personas = Vec::new();
        let Ok(entries) = std::fs::read_dir(&dir) else {
            return Vec::new();
        };

        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("md") {
                continue;
            }

            let Ok(content) = std::fs::read_to_string(&path) else {
                continue;
            };
            let trimmed = content.trim_start();
            if !trimmed.starts_with("---") {
                continue;
            }

            let after_first = &trimmed[3..];
            let Some(end_idx) = after_first.find("\n---") else {
                continue;
            };

            let yaml_str = &after_first[..end_idx];
            let body = after_first[end_idx + 4..].trim().to_string();
            let Ok(frontmatter) = serde_yaml::from_str::<MarkdownFrontmatter>(yaml_str) else {
                continue;
            };

            let slug = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("unknown")
                .to_string();
            let id = format!("md-{}", slug);

            let mod_time = std::fs::metadata(&path)
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| {
                    let duration = t.duration_since(std::time::UNIX_EPOCH).ok()?;
                    let dt = chrono::DateTime::from_timestamp(
                        duration.as_secs() as i64,
                        duration.subsec_nanos(),
                    )?;
                    Some(dt.to_rfc3339())
                })
                .unwrap_or_else(|| chrono::Utc::now().to_rfc3339());

            let system_prompt = if body.is_empty() {
                frontmatter
                    .description
                    .clone()
                    .unwrap_or_else(|| format!("You are {}.", frontmatter.name))
            } else {
                body
            };

            personas.push(Persona {
                id,
                display_name: frontmatter.name,
                avatar: None,
                system_prompt,
                provider: None,
                model: None,
                is_builtin: false,
                is_from_disk: true,
                created_at: mod_time.clone(),
                updated_at: mod_time,
            });
        }

        personas
    }

    fn builtin_personas() -> Vec<Persona> {
        let now = chrono::Utc::now().to_rfc3339();
        vec![
            Persona {
                id: "builtin-solo".to_string(),
                display_name: "Solo".to_string(),
                avatar: None,
                system_prompt: "You are Solo.".to_string(),
                provider: Some("goose".to_string()),
                model: Some("claude-sonnet-4-20250514".to_string()),
                is_builtin: true,
                is_from_disk: false,
                created_at: now.clone(),
                updated_at: now.clone(),
            },
            Persona {
                id: "builtin-scout".to_string(),
                display_name: "Scout".to_string(),
                avatar: None,
                system_prompt: "You are Scout.".to_string(),
                provider: Some("goose".to_string()),
                model: Some("claude-sonnet-4-20250514".to_string()),
                is_builtin: true,
                is_from_disk: false,
                created_at: now.clone(),
                updated_at: now.clone(),
            },
            Persona {
                id: "builtin-ralph".to_string(),
                display_name: "Ralph".to_string(),
                avatar: None,
                system_prompt: "You are Ralph.".to_string(),
                provider: Some("goose".to_string()),
                model: Some("claude-sonnet-4-20250514".to_string()),
                is_builtin: true,
                is_from_disk: false,
                created_at: now.clone(),
                updated_at: now,
            },
        ]
    }

    fn merge_all(stored: Vec<Persona>, markdown: Vec<Persona>) -> Vec<Persona> {
        let builtins = Self::builtin_personas();
        let mut result = builtins;
        let mut seen_names: HashSet<String> = result
            .iter()
            .map(|p| p.display_name.to_lowercase())
            .collect();
        let mut seen_ids: HashSet<String> = result.iter().map(|p| p.id.clone()).collect();

        for persona in stored {
            if !seen_ids.contains(&persona.id) {
                seen_names.insert(persona.display_name.to_lowercase());
                seen_ids.insert(persona.id.clone());
                result.push(persona);
            }
        }

        for persona in markdown {
            if !seen_names.contains(&persona.display_name.to_lowercase())
                && !seen_ids.contains(&persona.id)
            {
                seen_names.insert(persona.display_name.to_lowercase());
                seen_ids.insert(persona.id.clone());
                result.push(persona);
            }
        }

        result
    }

    fn save_to_disk(&self, personas: &[Persona]) {
        if let Some(parent) = self.store_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let custom: Vec<&Persona> = personas
            .iter()
            .filter(|p| !p.is_builtin && !p.is_from_disk)
            .collect();
        if let Ok(json) = serde_json::to_string_pretty(&custom) {
            let _ = std::fs::write(&self.store_path, json);
        }
    }

    fn list(&self) -> Vec<Persona> {
        self.personas.lock().unwrap().clone()
    }

    fn refresh_markdown(&self) -> Vec<Persona> {
        let stored = Self::load_from_disk(&self.store_path);
        let markdown = Self::load_markdown_personas();
        let merged = Self::merge_all(stored, markdown);

        let mut personas = self.personas.lock().unwrap();
        *personas = merged;
        personas.clone()
    }

    fn create(&self, req: CreatePersonaRequest) -> Persona {
        let now = chrono::Utc::now().to_rfc3339();
        let persona = Persona {
            id: uuid::Uuid::new_v4().to_string(),
            display_name: req.display_name,
            avatar: req.avatar,
            system_prompt: req.system_prompt,
            provider: req.provider,
            model: req.model,
            is_builtin: false,
            is_from_disk: false,
            created_at: now.clone(),
            updated_at: now,
        };

        let mut personas = self.personas.lock().unwrap();
        personas.push(persona.clone());
        self.save_to_disk(&personas);
        persona
    }

    fn get(&self, id: &str) -> Option<Persona> {
        self.personas
            .lock()
            .unwrap()
            .iter()
            .find(|p| p.id == id)
            .cloned()
    }

    fn update(&self, id: &str, req: UpdatePersonaRequest) -> Result<Persona, ErrorResponse> {
        let mut personas = self.personas.lock().unwrap();
        let persona = personas
            .iter_mut()
            .find(|p| p.id == id)
            .ok_or_else(|| ErrorResponse::not_found(format!("Persona '{}' not found", id)))?;

        if persona.is_builtin {
            return Err(ErrorResponse::bad_request(
                "Cannot update a built-in persona",
            ));
        }
        if persona.is_from_disk {
            return Err(ErrorResponse::bad_request(
                "Cannot update a markdown persona — edit the file directly",
            ));
        }

        if let Some(name) = req.display_name {
            persona.display_name = name;
        }
        if let Some(avatar_value) = req.avatar {
            persona.avatar = avatar_value;
        }
        if let Some(prompt) = req.system_prompt {
            persona.system_prompt = prompt;
        }
        if let Some(provider) = req.provider {
            persona.provider = Some(provider);
        }
        if let Some(model) = req.model {
            persona.model = Some(model);
        }
        persona.updated_at = chrono::Utc::now().to_rfc3339();

        let updated = persona.clone();
        self.save_to_disk(&personas);
        Ok(updated)
    }

    fn delete(&self, id: &str) -> Result<(), ErrorResponse> {
        let mut personas = self.personas.lock().unwrap();
        let persona = personas
            .iter()
            .find(|p| p.id == id)
            .cloned()
            .ok_or_else(|| ErrorResponse::not_found(format!("Persona '{}' not found", id)))?;

        if persona.is_builtin {
            return Err(ErrorResponse::bad_request(
                "Cannot delete a built-in persona",
            ));
        }

        if let Some(Avatar::Local(filename)) = &persona.avatar {
            let path = Self::avatars_dir().join(filename);
            let _ = std::fs::remove_file(path);
        }

        personas.retain(|p| p.id != id);
        self.save_to_disk(&personas);
        Ok(())
    }

    fn save_avatar_from_path(persona_id: &str, source_path: &str) -> Result<String, ErrorResponse> {
        let avatars_dir = Self::avatars_dir();
        std::fs::create_dir_all(&avatars_dir).map_err(|e| {
            ErrorResponse::internal(format!("Failed to create avatars directory: {}", e))
        })?;

        let source = std::path::Path::new(source_path);
        let ext = source
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("png")
            .to_lowercase();

        let stored_name = format!("{}.{}", persona_id, ext);
        let dest = avatars_dir.join(&stored_name);

        if let Ok(entries) = std::fs::read_dir(&avatars_dir) {
            let prefix = format!("{}.", persona_id);
            for entry in entries.flatten() {
                let name = entry.file_name();
                if let Some(name_str) = name.to_str() {
                    if name_str.starts_with(&prefix) && name_str != stored_name {
                        let _ = std::fs::remove_file(entry.path());
                    }
                }
            }
        }

        std::fs::copy(source, &dest).map_err(|e| {
            ErrorResponse::bad_request(format!("Failed to copy avatar file: {}", e))
        })?;

        Ok(stored_name)
    }

    fn save_avatar_from_bytes(
        persona_id: &str,
        bytes: &[u8],
        extension: &str,
    ) -> Result<String, ErrorResponse> {
        let avatars_dir = Self::avatars_dir();
        std::fs::create_dir_all(&avatars_dir).map_err(|e| {
            ErrorResponse::internal(format!("Failed to create avatars directory: {}", e))
        })?;

        let ext = extension.to_lowercase();
        let stored_name = format!("{}.{}", persona_id, ext);
        let dest = avatars_dir.join(&stored_name);

        if let Ok(entries) = std::fs::read_dir(&avatars_dir) {
            let prefix = format!("{}.", persona_id);
            for entry in entries.flatten() {
                let name = entry.file_name();
                if let Some(name_str) = name.to_str() {
                    if name_str.starts_with(&prefix) && name_str != stored_name {
                        let _ = std::fs::remove_file(entry.path());
                    }
                }
            }
        }

        std::fs::write(&dest, bytes).map_err(|e| {
            ErrorResponse::bad_request(format!("Failed to write avatar file: {}", e))
        })?;

        Ok(stored_name)
    }
}

fn slugify(name: &str) -> String {
    let slug: String = name
        .to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect();

    let mut collapsed = String::with_capacity(slug.len());
    let mut prev_hyphen = false;
    for c in slug.chars() {
        if c == '-' {
            if !prev_hyphen {
                collapsed.push('-');
            }
            prev_hyphen = true;
        } else {
            collapsed.push(c);
            prev_hyphen = false;
        }
    }

    let trimmed = collapsed.trim_matches('-');
    let result = if trimmed.len() > 50 {
        trimmed[..50].trim_end_matches('-').to_string()
    } else {
        trimmed.to_string()
    };

    if result.is_empty() {
        "persona".to_string()
    } else {
        result
    }
}

#[derive(Clone)]
struct PersonasState {
    store: Arc<PersonaStore>,
}

async fn list_personas(State(state): State<PersonasState>) -> Json<Vec<Persona>> {
    Json(state.store.list())
}

async fn create_persona(
    State(state): State<PersonasState>,
    Json(request): Json<CreatePersonaRequest>,
) -> Json<Persona> {
    Json(state.store.create(request))
}

async fn update_persona(
    State(state): State<PersonasState>,
    Path(id): Path<String>,
    Json(request): Json<UpdatePersonaRequest>,
) -> Result<Json<Persona>, ErrorResponse> {
    Ok(Json(state.store.update(&id, request)?))
}

async fn delete_persona(
    State(state): State<PersonasState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, ErrorResponse> {
    state.store.delete(&id)?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

async fn refresh_personas(State(state): State<PersonasState>) -> Json<Vec<Persona>> {
    Json(state.store.refresh_markdown())
}

async fn export_persona(
    State(state): State<PersonasState>,
    Path(id): Path<String>,
) -> Result<Json<ExportResult>, ErrorResponse> {
    let persona = state
        .store
        .get(&id)
        .ok_or_else(|| ErrorResponse::not_found(format!("Persona '{}' not found", id)))?;

    let export_avatar = match &persona.avatar {
        Some(Avatar::Url(url)) => Some(Avatar::Url(url.clone())),
        _ => None,
    };

    let export = PersonaExportV1 {
        version: 1,
        display_name: persona.display_name.clone(),
        system_prompt: persona.system_prompt,
        avatar: export_avatar,
        provider: persona.provider,
        model: persona.model,
    };

    let json = serde_json::to_string_pretty(&export)
        .map_err(|e| ErrorResponse::internal(format!("Failed to serialize persona: {}", e)))?;

    let slug = slugify(&persona.display_name);
    let suggested_filename = format!("{}.persona.json", slug);

    Ok(Json(ExportResult {
        json,
        suggested_filename,
    }))
}

async fn import_personas(
    State(state): State<PersonasState>,
    Json(request): Json<ImportRequest>,
) -> Result<Json<Vec<Persona>>, ErrorResponse> {
    if !request.file_name.ends_with(".persona.json") && !request.file_name.ends_with(".json") {
        return Err(ErrorResponse::bad_request(
            "Unsupported file type. Expected a .persona.json or .json file.",
        ));
    }

    let content = String::from_utf8(request.file_bytes)
        .map_err(|_| ErrorResponse::bad_request("File is not valid UTF-8 text"))?;

    let export: PersonaExportV1 = serde_json::from_str(&content)
        .map_err(|e| ErrorResponse::bad_request(format!("Invalid persona JSON: {}", e)))?;

    if export.version != 1 {
        return Err(ErrorResponse::bad_request(format!(
            "Unsupported persona format version {}. Expected version 1.",
            export.version
        )));
    }

    if export.display_name.trim().is_empty() {
        return Err(ErrorResponse::bad_request(
            "Persona displayName cannot be empty",
        ));
    }
    if export.system_prompt.trim().is_empty() {
        return Err(ErrorResponse::bad_request(
            "Persona systemPrompt cannot be empty",
        ));
    }

    let request = CreatePersonaRequest {
        display_name: export.display_name,
        avatar: export.avatar,
        system_prompt: export.system_prompt,
        provider: export.provider,
        model: export.model,
    };

    let persona = state.store.create(request);
    Ok(Json(vec![persona]))
}

async fn save_persona_avatar(
    State(_state): State<PersonasState>,
    Json(request): Json<SaveAvatarPathRequest>,
) -> Result<Json<SaveAvatarResponse>, ErrorResponse> {
    let filename = PersonaStore::save_avatar_from_path(&request.persona_id, &request.source_path)?;
    Ok(Json(SaveAvatarResponse { filename }))
}

async fn save_persona_avatar_bytes(
    State(_state): State<PersonasState>,
    Json(request): Json<SaveAvatarBytesRequest>,
) -> Result<Json<SaveAvatarResponse>, ErrorResponse> {
    let filename = PersonaStore::save_avatar_from_bytes(
        &request.persona_id,
        &request.bytes,
        &request.extension,
    )?;
    Ok(Json(SaveAvatarResponse { filename }))
}

fn validate_avatar_filename(filename: &str) -> Result<(), ErrorResponse> {
    if filename.is_empty() {
        return Err(ErrorResponse::bad_request(
            "Avatar filename cannot be empty",
        ));
    }
    let path = StdPath::new(filename);
    let mut components = path.components();
    match (components.next(), components.next()) {
        (Some(Component::Normal(_)), None) => Ok(()),
        _ => Err(ErrorResponse::bad_request("Invalid avatar filename")),
    }
}

async fn read_avatar(Path(filename): Path<String>) -> Result<impl IntoResponse, ErrorResponse> {
    validate_avatar_filename(&filename)?;
    let path = PersonaStore::avatars_dir().join(&filename);

    let bytes = std::fs::read(&path)
        .map_err(|_| ErrorResponse::not_found(format!("Avatar '{}' not found", filename)))?;
    let mime = mime_guess::from_path(&path)
        .first_or_octet_stream()
        .essence_str()
        .to_string();

    Ok(([(CONTENT_TYPE, mime)], Body::from(bytes)))
}

pub fn routes() -> Router {
    let state = PersonasState {
        store: Arc::new(PersonaStore::new()),
    };

    Router::new()
        .route("/personas", get(list_personas).post(create_persona))
        .route("/personas/{id}", put(update_persona).delete(delete_persona))
        .route("/personas/refresh", post(refresh_personas))
        .route("/personas/{id}/export", get(export_persona))
        .route("/personas/import", post(import_personas))
        .route("/personas/avatar/save-path", post(save_persona_avatar))
        .route(
            "/personas/avatar/save-bytes",
            post(save_persona_avatar_bytes),
        )
        .route("/personas/avatar/{filename}", get(read_avatar))
        .with_state(state)
}
