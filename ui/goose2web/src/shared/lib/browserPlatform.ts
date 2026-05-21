export const REMOTE_FILE_OPEN_EVENT = "goose:remote-file-open";

export interface RemoteFileOpenRequest {
  path: string;
  reject: (error: Error) => void;
  resolve: () => void;
}

function normalizeExternalUrl(url: string): string {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http and https links can be opened.");
  }
  return parsed.href;
}

export async function openExternalUrl(url: string): Promise<void> {
  const normalizedUrl = normalizeExternalUrl(url);
  const opened = window.open(normalizedUrl, "_blank", "noopener,noreferrer");
  if (!opened) {
    throw new Error("The browser blocked the popup.");
  }
}

export function openRemoteFileInChat(path: string): Promise<void> {
  const normalizedPath = path.trim();
  if (!normalizedPath) {
    return Promise.reject(new Error("No remote path was provided."));
  }

  return new Promise<void>((resolve, reject) => {
    window.dispatchEvent(
      new CustomEvent<RemoteFileOpenRequest>(REMOTE_FILE_OPEN_EVENT, {
        detail: {
          path: normalizedPath,
          reject,
          resolve,
        },
      }),
    );
  });
}
