const BACKEND_SERVERS_STORAGE_KEY = "goose-backend-servers";
const BACKEND_ACTIVE_SERVER_STORAGE_KEY = "goose-backend-active-server";
const BACKEND_SERVER_AUTH_STORAGE_KEY = "goose-backend-server-auth";

export type BackendServers = Record<string, string>;
export interface BackendServerAuth {
  username: string;
  token: string;
}

function normalizeServerName(name: string): string {
  return name.trim();
}

function normalizeServerUrl(url: string): string {
  return url.trim();
}

function withAcpPath(url: URL): URL {
  if (!url.pathname || url.pathname === "/") {
    url.pathname = "/acp";
  }
  return url;
}

export function resolveBackendServerUrl(url: string): string | null {
  const normalized = normalizeServerUrl(url);
  if (!normalized) {
    return null;
  }

  const hasExplicitScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(normalized);
  let parsed: URL;

  if (hasExplicitScheme) {
    try {
      parsed = new URL(normalized);
    } catch {
      return null;
    }
    if (parsed.protocol === "http:") {
      parsed.protocol = "ws:";
    } else if (parsed.protocol === "https:") {
      parsed.protocol = "wss:";
    } else if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") {
      return null;
    }
  } else {
    try {
      const hostPortOrPath = normalized.startsWith("//")
        ? normalized.slice(2)
        : normalized;
      parsed = new URL(`ws://${hostPortOrPath}`);
    } catch {
      return null;
    }
  }

  return withAcpPath(parsed).toString();
}

function readServersRaw(): BackendServers {
  try {
    const raw = localStorage.getItem(BACKEND_SERVERS_STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    const entries = Object.entries(parsed as Record<string, unknown>);
    const servers: BackendServers = {};
    for (const [name, value] of entries) {
      if (typeof value !== "string") {
        continue;
      }
      const normalizedName = normalizeServerName(name);
      const normalizedUrl = normalizeServerUrl(value);
      if (!normalizedName || !normalizedUrl) {
        continue;
      }
      servers[normalizedName] = normalizedUrl;
    }
    return servers;
  } catch {
    return {};
  }
}

function writeServersRaw(servers: BackendServers): void {
  localStorage.setItem(BACKEND_SERVERS_STORAGE_KEY, JSON.stringify(servers));
}

function readServerAuthRaw(): Record<string, BackendServerAuth> {
  try {
    const raw = localStorage.getItem(BACKEND_SERVER_AUTH_STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    const entries = Object.entries(parsed as Record<string, unknown>);
    const authMap: Record<string, BackendServerAuth> = {};
    for (const [name, value] of entries) {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        continue;
      }
      const username =
        typeof (value as { username?: unknown }).username === "string"
          ? (value as { username: string }).username.trim()
          : "";
      const token =
        typeof (value as { token?: unknown }).token === "string"
          ? (value as { token: string }).token.trim()
          : "";
      authMap[normalizeServerName(name)] = { username, token };
    }
    return authMap;
  } catch {
    return {};
  }
}

function writeServerAuthRaw(authMap: Record<string, BackendServerAuth>): void {
  localStorage.setItem(
    BACKEND_SERVER_AUTH_STORAGE_KEY,
    JSON.stringify(authMap),
  );
}

export function getBackendServers(): BackendServers {
  return readServersRaw();
}

export function getActiveBackendServerName(): string | null {
  const active = localStorage.getItem(BACKEND_ACTIVE_SERVER_STORAGE_KEY);
  const normalized = active ? normalizeServerName(active) : "";
  if (normalized) {
    return normalized;
  }

  const servers = readServersRaw();
  const firstServerName = Object.keys(servers)[0];
  return firstServerName || null;
}

export function setActiveBackendServerName(serverName: string): void {
  const normalized = normalizeServerName(serverName);
  if (!normalized) {
    localStorage.removeItem(BACKEND_ACTIVE_SERVER_STORAGE_KEY);
    return;
  }
  localStorage.setItem(BACKEND_ACTIVE_SERVER_STORAGE_KEY, normalized);
}

export function setBackendServer(serverName: string, serverUrl: string): void {
  const normalizedName = normalizeServerName(serverName);
  const normalizedUrl = normalizeServerUrl(serverUrl);
  if (!normalizedName || !normalizedUrl) {
    return;
  }
  const next = readServersRaw();
  next[normalizedName] = normalizedUrl;
  writeServersRaw(next);
}

export function removeBackendServer(serverName: string): void {
  const normalizedName = normalizeServerName(serverName);
  if (!normalizedName) {
    return;
  }
  const next = readServersRaw();
  delete next[normalizedName];
  writeServersRaw(next);
  removeBackendServerAuth(normalizedName);

  const activeName = getActiveBackendServerName();
  if (activeName !== normalizedName) {
    return;
  }

  const remainingNames = Object.keys(next);
  if (remainingNames.length === 0) {
    localStorage.removeItem(BACKEND_ACTIVE_SERVER_STORAGE_KEY);
    return;
  }

  setActiveBackendServerName(remainingNames[0]);
}

export function getActiveBackendServerUrl(): string | null {
  const servers = readServersRaw();
  const activeName = getActiveBackendServerName();
  if (activeName && servers[activeName]) {
    return resolveBackendServerUrl(servers[activeName]);
  }
  return null;
}

export function getBackendServerAuth(
  serverName: string,
): BackendServerAuth | null {
  const normalizedName = normalizeServerName(serverName);
  if (!normalizedName) {
    return null;
  }
  const authMap = readServerAuthRaw();
  return authMap[normalizedName] ?? null;
}

export function setBackendServerAuth(
  serverName: string,
  auth: Partial<BackendServerAuth>,
): void {
  const normalizedName = normalizeServerName(serverName);
  if (!normalizedName) {
    return;
  }
  const authMap = readServerAuthRaw();
  authMap[normalizedName] = {
    username: (auth.username ?? "").trim(),
    token: (auth.token ?? "").trim(),
  };
  writeServerAuthRaw(authMap);
}

export function removeBackendServerAuth(serverName: string): void {
  const normalizedName = normalizeServerName(serverName);
  if (!normalizedName) {
    return;
  }
  const authMap = readServerAuthRaw();
  if (!(normalizedName in authMap)) {
    return;
  }
  delete authMap[normalizedName];
  writeServerAuthRaw(authMap);
}

// Temporary compatibility for existing settings UI.
export function getStoredBackendUrl(): string | null {
  const servers = readServersRaw();
  const activeName = getActiveBackendServerName();
  if (activeName && servers[activeName]) {
    return servers[activeName];
  }
  return null;
}

export function setStoredBackendUrl(url: string): void {
  const normalized = normalizeServerUrl(url);
  if (!normalized) {
    clearStoredBackendUrl();
    return;
  }
  const defaultServerName = "default";
  setBackendServer(defaultServerName, normalized);
  setActiveBackendServerName(defaultServerName);
}

export function clearStoredBackendUrl(): void {
  const activeName = getActiveBackendServerName();
  if (activeName) {
    removeBackendServer(activeName);
    return;
  }
  const servers = readServersRaw();
  const firstName = Object.keys(servers)[0];
  if (firstName) {
    removeBackendServer(firstName);
  }
}
