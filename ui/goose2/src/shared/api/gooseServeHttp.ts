import { getGooseServeHostInfo } from "./gooseServeHost";

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

export interface RequestOptions {
  method?: HttpMethod;
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

function buildQueryString(
  query: Record<string, string | number | boolean | undefined | null>,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    params.set(key, String(value));
  }
  const rendered = params.toString();
  return rendered ? `?${rendered}` : "";
}

export async function backendFetch(
  path: string,
  options: RequestOptions = {},
): Promise<Response> {
  const { httpBaseUrl, secretKey } = await getGooseServeHostInfo();
  const method = options.method ?? "GET";
  const queryString = options.query ? buildQueryString(options.query) : "";

  const url = `${httpBaseUrl}${path}${queryString}`;
  const headers: Record<string, string> = {
    "X-Secret-Key": secretKey,
    ...(options.headers ?? {}),
  };

  let body: BodyInit | undefined;
  if (options.body !== undefined) {
    headers["Content-Type"] = headers["Content-Type"] ?? "application/json";
    body = JSON.stringify(options.body);
  }

  return fetch(url, {
    method,
    headers,
    body,
    signal: options.signal,
  });
}

export async function fetchJson<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const response = await backendFetch(path, options);
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "message" in payload
        ? String((payload as { message: unknown }).message)
        : `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  return payload as T;
}
