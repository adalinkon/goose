import { backendFetch, fetchJson } from "@/shared/api/gooseServeHttp";

type UnlistenFn = () => void;

interface SetupEvent {
  event: "log" | "done";
  providerId: string;
  line?: string;
  success?: boolean;
  error?: string;
}

const listeners = new Map<string, Set<(line: string) => void>>();

function emit(providerId: string, line: string) {
  const callbacks = listeners.get(providerId);
  if (!callbacks) return;
  for (const callback of callbacks) {
    callback(line);
  }
}

async function runSetupStream(path: string, providerId: string): Promise<void> {
  const response = await backendFetch(path, {
    method: "POST",
    body: { providerId },
  });

  if (!response.body) {
    throw new Error("No setup output received");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let done = false;

  while (!done) {
    const next = await reader.read();
    done = next.done;
    buffer += decoder.decode(next.value ?? new Uint8Array(), { stream: !done });

    const parts = buffer.split("\n");
    buffer = parts.pop() ?? "";

    for (const line of parts) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      const event = JSON.parse(trimmed) as SetupEvent;
      if (event.event === "log" && event.line) {
        emit(providerId, event.line);
      }
      if (event.event === "done") {
        if (event.success) {
          return;
        }
        throw new Error(event.error ?? "Agent setup failed");
      }
    }
  }

  throw new Error("Agent setup ended unexpectedly");
}

export async function checkAgentInstalled(
  providerId: string,
): Promise<boolean> {
  const response = await fetchJson<{ value: boolean }>(
    "/providers/setup/agent/check-installed",
    {
      query: { providerId },
    },
  );
  return response.value;
}

export async function checkAgentAuth(providerId: string): Promise<boolean> {
  const response = await fetchJson<{ value: boolean }>(
    "/providers/setup/agent/check-auth",
    {
      query: { providerId },
    },
  );
  return response.value;
}

export async function installAgent(providerId: string): Promise<void> {
  return runSetupStream("/providers/setup/agent/install", providerId);
}

export async function authenticateAgent(providerId: string): Promise<void> {
  return runSetupStream("/providers/setup/agent/authenticate", providerId);
}

export async function onAgentSetupOutput(
  providerId: string,
  callback: (line: string) => void,
): Promise<UnlistenFn> {
  const set = listeners.get(providerId) ?? new Set<(line: string) => void>();
  set.add(callback);
  listeners.set(providerId, set);

  return () => {
    const callbacks = listeners.get(providerId);
    if (!callbacks) return;
    callbacks.delete(callback);
    if (callbacks.size === 0) {
      listeners.delete(providerId);
    }
  };
}
