import { resolveBackendServerUrl } from "./backendConfig";

function withSecretQuery(url: string, secretKey?: string): string {
  if (!secretKey) {
    return url;
  }
  const parsed = new URL(url);
  parsed.searchParams.set("secret", secretKey);
  return parsed.toString();
}

export async function checkBackendServerConnection(
  serverUrl: string,
  secretKey?: string,
  timeoutMs = 2_500,
): Promise<boolean> {
  const resolvedUrl = resolveBackendServerUrl(serverUrl);
  if (!resolvedUrl || typeof WebSocket === "undefined") {
    return false;
  }

  return new Promise<boolean>((resolve) => {
    let settled = false;
    let socket: WebSocket;

    try {
      socket = new WebSocket(withSecretQuery(resolvedUrl, secretKey));
    } catch {
      resolve(false);
      return;
    }

    const settle = (connected: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutId);
      socket.removeEventListener("open", handleOpen);
      socket.removeEventListener("error", handleError);
      socket.removeEventListener("close", handleClose);
      if (
        socket.readyState === WebSocket.CONNECTING ||
        socket.readyState === WebSocket.OPEN
      ) {
        socket.close();
      }
      resolve(connected);
    };

    const handleOpen = () => settle(true);
    const handleError = () => settle(false);
    const handleClose = () => settle(false);

    const timeoutId = setTimeout(() => settle(false), timeoutMs);

    socket.addEventListener("open", handleOpen);
    socket.addEventListener("error", handleError);
    socket.addEventListener("close", handleClose);
  });
}
