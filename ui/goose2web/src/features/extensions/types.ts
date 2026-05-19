export interface StdioExtensionConfig {
  type: "stdio";
  name: string;
  description: string;
  cmd: string;
  args: string[];
  envs?: Record<string, string>;
  env_keys?: string[];
  timeout?: number;
  bundled?: boolean;
  available_tools?: string[];
}

export interface BuiltinExtensionConfig {
  type: "builtin";
  name: string;
  description: string;
  display_name?: string;
  timeout?: number;
  bundled?: boolean;
  available_tools?: string[];
}

export interface PlatformExtensionConfig {
  type: "platform";
  name: string;
  description: string;
  display_name?: string;
  bundled?: boolean;
  available_tools?: string[];
}

export interface StreamableHttpExtensionConfig {
  type: "streamable_http";
  name: string;
  description: string;
  uri: string;
  envs?: Record<string, string>;
  env_keys?: string[];
  headers?: Record<string, string>;
  timeout?: number;
  socket?: string;
  backend?: StreamableHttpBackendConfig;
  bundled?: boolean;
  available_tools?: string[];
}

export interface StreamableHttpBackendConfig {
  id: string;
  cmd: string;
  args?: string[];
  envs?: Record<string, string>;
  env_keys?: string[];
  timeout?: number;
  idle_timeout?: number;
}

export interface SseExtensionConfig {
  type: "sse";
  name: string;
  description: string;
  uri?: string;
  bundled?: boolean;
}

export interface FrontendExtensionConfig {
  type: "frontend";
  name: string;
  description: string;
  tools: unknown[];
  frontend_tools?: unknown[];
  instructions?: string;
  bundled?: boolean;
  available_tools?: string[];
}

export interface InlinePythonExtensionConfig {
  type: "inline_python";
  name: string;
  description: string;
  code: string;
  timeout?: number;
  dependencies?: string[];
  available_tools?: string[];
}

export type ExtensionConfig =
  | StdioExtensionConfig
  | BuiltinExtensionConfig
  | PlatformExtensionConfig
  | StreamableHttpExtensionConfig
  | SseExtensionConfig
  | FrontendExtensionConfig
  | InlinePythonExtensionConfig;

export type ExtensionEntry = ExtensionConfig & {
  config_key: string;
  enabled: boolean;
};

export interface ExtensionToolInfo {
  name: string;
  description?: string;
}

export function getDisplayName(ext: {
  type: ExtensionConfig["type"];
  name: string;
  display_name?: string | null;
}): string {
  if ((ext.type === "builtin" || ext.type === "platform") && ext.display_name) {
    return ext.display_name;
  }
  return ext.name;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function toolInfoFromValue(value: unknown): ExtensionToolInfo | null {
  if (typeof value === "string") return { name: value };
  if (!isRecord(value)) return null;

  const name =
    typeof value.name === "string"
      ? value.name
      : typeof value.toolName === "string"
        ? value.toolName
        : "";
  if (!name) return null;

  return {
    name,
    ...(typeof value.description === "string"
      ? { description: value.description }
      : {}),
  };
}

export function getExtensionToolInfos(
  extension: ExtensionEntry,
): ExtensionToolInfo[] {
  const tools: ExtensionToolInfo[] = [];
  const seen = new Set<string>();
  const addTool = (tool: ExtensionToolInfo | null) => {
    if (!tool || seen.has(tool.name)) return;
    seen.add(tool.name);
    tools.push(tool);
  };

  if ("tools" in extension && Array.isArray(extension.tools)) {
    for (const tool of extension.tools) addTool(toolInfoFromValue(tool));
  }
  if (
    "frontend_tools" in extension &&
    Array.isArray(extension.frontend_tools)
  ) {
    for (const tool of extension.frontend_tools)
      addTool(toolInfoFromValue(tool));
  }
  if (
    "available_tools" in extension &&
    Array.isArray(extension.available_tools)
  ) {
    for (const tool of extension.available_tools) addTool({ name: tool });
  }

  return tools;
}

export function getExtensionAvailableTools(
  extension: ExtensionEntry,
): string[] {
  return "available_tools" in extension &&
    Array.isArray(extension.available_tools)
    ? extension.available_tools
    : [];
}

export function extensionConfigWithAvailableTools(
  extension: ExtensionEntry,
  availableTools: string[],
): ExtensionConfig {
  const { config_key: _configKey, enabled: _enabled, ...config } = extension;

  switch (config.type) {
    case "stdio":
    case "builtin":
    case "platform":
    case "streamable_http":
    case "frontend":
    case "inline_python":
      return { ...config, available_tools: availableTools };
    case "sse":
      return config;
  }
}
