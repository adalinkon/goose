use super::*;
use std::collections::HashSet;

enum SessionExtensionsRuntime {
    Loading,
    Ready(Arc<Agent>),
    Failed,
    Stopped,
}

impl GooseAcpAgent {
    pub(super) async fn on_add_extension(
        &self,
        req: AddExtensionRequest,
    ) -> Result<EmptyResponse, agent_client_protocol::Error> {
        let session_id = &req.session_id;
        let config: ExtensionConfig = serde_json::from_value(req.config).map_err(|e| {
            agent_client_protocol::Error::invalid_params().data(format!("bad config: {e}"))
        })?;
        let agent = self.get_session_agent(&req.session_id, None).await?;
        agent
            .add_extension(config, session_id)
            .await
            .internal_err()?;
        Ok(EmptyResponse {})
    }

    pub(super) async fn on_remove_extension(
        &self,
        req: RemoveExtensionRequest,
    ) -> Result<EmptyResponse, agent_client_protocol::Error> {
        let session_id = &req.session_id;
        let agent = self.get_session_agent(&req.session_id, None).await?;
        agent
            .remove_extension(&req.name, session_id)
            .await
            .internal_err()?;
        Ok(EmptyResponse {})
    }

    pub(super) async fn on_get_extensions(
        &self,
    ) -> Result<GetExtensionsResponse, agent_client_protocol::Error> {
        let extensions = crate::config::extensions::get_all_extensions()
            .into_iter()
            .filter(|ext| {
                !crate::agents::extension_manager::is_hidden_extension(&ext.config.name())
            })
            .collect::<Vec<_>>();
        let warnings = crate::config::extensions::get_warnings();
        let extensions_json = extensions
            .into_iter()
            .map(|e| {
                let config_key = e.config.key();
                let mut value = serde_json::to_value(&e)?;
                if let Some(obj) = value.as_object_mut() {
                    obj.insert(
                        "config_key".to_string(),
                        serde_json::Value::String(config_key),
                    );
                }
                Ok::<_, serde_json::Error>(value)
            })
            .collect::<Result<Vec<_>, _>>()
            .internal_err()?;
        Ok(GetExtensionsResponse {
            extensions: extensions_json,
            warnings,
        })
    }

    pub(super) async fn on_add_config_extension(
        &self,
        req: AddConfigExtensionRequest,
    ) -> Result<EmptyResponse, agent_client_protocol::Error> {
        let mut obj = match req.extension_config {
            serde_json::Value::Object(obj) => obj,
            _ => {
                return Err(agent_client_protocol::Error::invalid_params()
                    .data("extensionConfig must be a JSON object"));
            }
        };
        obj.insert(
            "name".to_string(),
            serde_json::Value::String(req.name.clone()),
        );

        let config: crate::agents::ExtensionConfig =
            serde_json::from_value(serde_json::Value::Object(obj)).map_err(|e| {
                agent_client_protocol::Error::invalid_params().data(format!("bad config: {e}"))
            })?;

        crate::config::extensions::set_extension(crate::config::extensions::ExtensionEntry {
            enabled: req.enabled,
            config,
        });
        Ok(EmptyResponse {})
    }

    pub(super) async fn on_remove_config_extension(
        &self,
        req: RemoveConfigExtensionRequest,
    ) -> Result<EmptyResponse, agent_client_protocol::Error> {
        let keys = crate::config::extensions::get_all_extension_names();
        if !keys.iter().any(|k| k == &req.config_key) {
            return Err(agent_client_protocol::Error::invalid_params()
                .data(format!("Extension '{}' not found", req.config_key)));
        }
        crate::config::extensions::remove_extension(&req.config_key);
        Ok(EmptyResponse {})
    }

    pub(super) async fn on_toggle_config_extension(
        &self,
        req: ToggleConfigExtensionRequest,
    ) -> Result<EmptyResponse, agent_client_protocol::Error> {
        let keys = crate::config::extensions::get_all_extension_names();
        if !keys.iter().any(|k| k == &req.config_key) {
            return Err(agent_client_protocol::Error::invalid_params()
                .data(format!("Extension '{}' not found", req.config_key)));
        }
        crate::config::extensions::set_extension_enabled(&req.config_key, req.enabled);
        Ok(EmptyResponse {})
    }

    pub(super) async fn on_get_session_extensions(
        &self,
        req: GetSessionExtensionsRequest,
    ) -> Result<GetSessionExtensionsResponse, agent_client_protocol::Error> {
        let session_id = &req.session_id;
        let session = self
            .session_manager
            .get_session(session_id, false)
            .await
            .internal_err()?;

        let extensions = EnabledExtensionsState::extensions_or_default(
            Some(&session.extension_data),
            crate::config::Config::global(),
        );

        let runtime = {
            let sessions = self.sessions.lock().await;
            match sessions.get(session_id) {
                Some(session) => match &session.agent {
                    AgentHandle::Ready(agent) => SessionExtensionsRuntime::Ready(agent.clone()),
                    AgentHandle::Loading(rx) => match rx.borrow().as_ref() {
                        Some(Ok(AgentSetupProgress::FullyReady(agent))) => {
                            SessionExtensionsRuntime::Ready(agent.clone())
                        }
                        Some(Ok(AgentSetupProgress::ProviderReady(_))) | None => {
                            SessionExtensionsRuntime::Loading
                        }
                        Some(Err(_)) => SessionExtensionsRuntime::Failed,
                    },
                },
                None => SessionExtensionsRuntime::Stopped,
            }
        };

        let extensions = match runtime {
            SessionExtensionsRuntime::Loading => extensions
                .into_iter()
                .map(|extension| SessionExtensionInfo {
                    name: extension.name(),
                    status: SessionExtensionStatus::Starting,
                    tools: Vec::new(),
                })
                .collect(),
            SessionExtensionsRuntime::Failed => extensions
                .into_iter()
                .map(|extension| SessionExtensionInfo {
                    name: extension.name(),
                    status: SessionExtensionStatus::Failed,
                    tools: Vec::new(),
                })
                .collect(),
            SessionExtensionsRuntime::Stopped => extensions
                .into_iter()
                .map(|extension| SessionExtensionInfo {
                    name: extension.name(),
                    status: SessionExtensionStatus::Stopped,
                    tools: Vec::new(),
                })
                .collect(),
            SessionExtensionsRuntime::Ready(agent) => {
                let loaded_extension_names = agent.list_extensions().await;
                let loaded_extensions = loaded_extension_names
                    .iter()
                    .map(|name| crate::config::extensions::name_to_key(name))
                    .collect::<HashSet<_>>();

                let mut extension_names = extensions
                    .into_iter()
                    .map(|extension| extension.name())
                    .collect::<Vec<_>>();
                let expected_extensions = extension_names
                    .iter()
                    .map(|name| crate::config::extensions::name_to_key(name))
                    .collect::<HashSet<_>>();
                extension_names.extend(loaded_extension_names.into_iter().filter(|name| {
                    !expected_extensions.contains(&crate::config::extensions::name_to_key(name))
                }));

                let mut result = Vec::with_capacity(extension_names.len());
                for extension_name in extension_names {
                    let extension_key = crate::config::extensions::name_to_key(&extension_name);
                    let status = if loaded_extensions.contains(&extension_key) {
                        SessionExtensionStatus::Running
                    } else {
                        SessionExtensionStatus::Stopped
                    };
                    let tools = if matches!(status, SessionExtensionStatus::Running) {
                        agent
                            .list_tools(session_id, Some(extension_name.clone()))
                            .await
                            .into_iter()
                            .map(|tool| SessionExtensionTool {
                                name: tool.name.to_string(),
                                description: tool
                                    .description
                                    .map(|description| description.to_string()),
                            })
                            .collect()
                    } else {
                        Vec::new()
                    };
                    result.push(SessionExtensionInfo {
                        name: extension_name,
                        status,
                        tools,
                    });
                }
                result
            }
        };

        Ok(GetSessionExtensionsResponse { extensions })
    }
}
