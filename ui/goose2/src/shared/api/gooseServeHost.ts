import {
  getActiveBackendServerAuth,
  getActiveBackendServerUrl,
} from "./backendConfig";

export interface GooseServeHostInfo {
  // Rename to baseUrl when goose serve supports a secure local origin.
  httpBaseUrl: string;
  secretKey: string;
}

function wsToHttpBaseUrl(wsUrl: string): string {
  const parsed = new URL(wsUrl);
  const protocol = parsed.protocol === "wss:" ? "https:" : "http:";
  const pathname = parsed.pathname.replace(/\/+$/, "");
  const pathPrefix = pathname.endsWith("/acp")
    ? pathname.slice(0, -4)
    : pathname;
  return `${protocol}//${parsed.host}${pathPrefix}`;
}

export async function getGooseServeHostInfo(): Promise<GooseServeHostInfo> {
  const wsUrl = getActiveBackendServerUrl();
  if (!wsUrl) {
    throw new Error("No backend URL configured");
  }
  const secretKey = getActiveBackendServerAuth()?.token ?? "";
  return {
    httpBaseUrl: wsToHttpBaseUrl(wsUrl),
    secretKey,
  };
}
