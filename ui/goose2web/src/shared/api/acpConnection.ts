import {
  DEFAULT_GOOSE_MCP_HOST_CAPABILITIES,
  GooseClient,
  type GooseInitializeRequest,
} from "@aaif/goose-sdk";
import {
  PROTOCOL_VERSION,
  type Client,
  type SessionNotification,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
} from "@agentclientprotocol/sdk";
import packageJson from "../../../package.json";
import { createWebSocketStream } from "./createWebSocketStream";
import { perfLog } from "@/shared/lib/perfLog";
import {
  getActiveBackendServerAuth,
  getActiveBackendServerUrl,
} from "./backendConfig";

let notificationHandler: AcpNotificationHandler | null = null;

export interface AcpNotificationHandler {
  handleSessionNotification(notification: SessionNotification): Promise<void>;
}

export function setNotificationHandler(handler: AcpNotificationHandler): void {
  notificationHandler = handler;
}

let clientPromise: Promise<GooseClient> | null = null;
let resolvedClient: GooseClient | null = null;
let resolvedClientUrl: string | null = null;

type AcpBootstrapState =
  | { state: "ready"; url: string }
  | { state: "missing_url" }
  | { state: "invalid_url"; url: string };

let lastBootstrapStatus:
  | { state: "idle" }
  | { state: "missing_url" }
  | { state: "invalid_url"; url: string }
  | { state: "connect_failed"; url: string; message: string }
  | { state: "connected"; url: string } = { state: "idle" };

function createClientCallbacks(): () => Client {
  return () => ({
    requestPermission: async (
      args: RequestPermissionRequest,
    ): Promise<RequestPermissionResponse> => {
      const optionId = args.options?.[0]?.optionId ?? "approve";
      return {
        outcome: {
          outcome: "selected",
          optionId,
        },
      };
    },

    sessionUpdate: async (notification: SessionNotification): Promise<void> => {
      if (notificationHandler) {
        await notificationHandler.handleSessionNotification(notification);
      }
    },
  });
}

function monitorConnection(client: GooseClient): void {
  client.closed
    .then(() => {
      console.warn(
        "[acp] Connection closed. Will reconnect on next getClient().",
      );
      resolvedClient = null;
      clientPromise = null;
    })
    .catch(() => {
      console.warn(
        "[acp] Connection error. Will reconnect on next getClient().",
      );
      resolvedClient = null;
      clientPromise = null;
    });
}

async function initializeConnection(): Promise<GooseClient> {
  const tStart = performance.now();
  const bootstrapState = resolveBootstrapState();
  if (bootstrapState.state !== "ready") {
    if (bootstrapState.state === "missing_url") {
      lastBootstrapStatus = { state: "missing_url" };
      throw new Error("No backend URL configured");
    }
    lastBootstrapStatus = {
      state: "invalid_url",
      url: bootstrapState.url,
    };
    throw new Error(`Invalid backend URL: ${bootstrapState.url}`);
  }
  const wsUrl = bootstrapState.url;
  const secretKey = getActiveBackendServerAuth()?.token;

  const tStream = performance.now();
  const stream = createWebSocketStream(wsUrl, secretKey);

  const client = new GooseClient(createClientCallbacks(), stream);
  perfLog(
    `[perf:conn] ws stream + client created in ${(performance.now() - tStream).toFixed(1)}ms`,
  );

  const tInit = performance.now();
  await client.initialize({
    protocolVersion: PROTOCOL_VERSION,
    clientCapabilities: {
      _meta: {
        goose: {
          mcpHostCapabilities: DEFAULT_GOOSE_MCP_HOST_CAPABILITIES,
        },
      },
    },
    clientInfo: {
      name: packageJson.name,
      version: packageJson.version,
    },
  } satisfies GooseInitializeRequest);
  perfLog(
    `[perf:conn] client.initialize in ${(performance.now() - tInit).toFixed(1)}ms (total ${(performance.now() - tStart).toFixed(1)}ms)`,
  );

  monitorConnection(client);
  resolvedClientUrl = wsUrl;
  lastBootstrapStatus = { state: "connected", url: wsUrl };

  return client;
}

function isWebsocketUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "ws:" || parsed.protocol === "wss:";
  } catch {
    return false;
  }
}

function resolveBootstrapState(): AcpBootstrapState {
  const url = getActiveBackendServerUrl();
  if (!url) {
    return { state: "missing_url" };
  }
  if (!isWebsocketUrl(url)) {
    return { state: "invalid_url", url };
  }
  return { state: "ready", url };
}

export async function getClient(): Promise<GooseClient> {
  const activeUrl = getActiveBackendServerUrl();
  if (
    resolvedClient &&
    resolvedClientUrl &&
    activeUrl &&
    activeUrl !== resolvedClientUrl
  ) {
    resolvedClient = null;
    resolvedClientUrl = null;
    clientPromise = null;
  }

  if (resolvedClient) {
    return resolvedClient;
  }

  if (!clientPromise) {
    perfLog("[perf:conn] getClient() → initializing new ACP connection");
    clientPromise = initializeConnection()
      .then((client) => {
        resolvedClient = client;
        return client;
      })
      .catch((error) => {
        const bootstrapState = resolveBootstrapState();
        const failedUrl =
          bootstrapState.state === "ready" ? bootstrapState.url : activeUrl;
        if (failedUrl) {
          lastBootstrapStatus = {
            state: "connect_failed",
            url: failedUrl,
            message: error instanceof Error ? error.message : String(error),
          };
        }
        clientPromise = null;
        throw error;
      });
  } else {
    perfLog("[perf:conn] getClient() awaiting in-flight initializeConnection");
  }

  return clientPromise;
}

export function isClientReady(): boolean {
  return resolvedClient !== null;
}

export function getClientSync(): GooseClient | null {
  return resolvedClient;
}

export function getAcpBootstrapStatus() {
  return lastBootstrapStatus;
}
