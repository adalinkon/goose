import { fetchJson } from "./gooseServeHttp";

export interface FileTreeEntry {
  name: string;
  path: string;
  kind: "file" | "directory";
}

export interface AttachmentPathInfo {
  name: string;
  path: string;
  kind: "file" | "directory";
  mimeType?: string | null;
}

export interface ImageAttachmentPayload {
  base64: string;
  mimeType: string;
}

export async function getHomeDir(): Promise<string> {
  const response = await fetchJson<{ path: string }>("/fs/home-dir");
  return response.path;
}

export async function saveExportedSessionFile(
  defaultFilename: string,
  contents: string,
): Promise<string | null> {
  const blob = new Blob([contents], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = defaultFilename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return defaultFilename;
}

export async function pathExists(path: string): Promise<boolean> {
  const response = await fetchJson<{ exists: boolean }>("/fs/path-exists", {
    query: { path },
  });
  return response.exists;
}

export async function listFilesForMentions(
  roots: string[],
  maxResults = 1500,
): Promise<string[]> {
  const response = await fetchJson<{ files: string[] }>(
    "/fs/list-files-for-mentions",
    {
      method: "POST",
      body: { roots, maxResults },
    },
  );
  return response.files ?? [];
}

export async function listDirectoryEntries(
  path: string,
): Promise<FileTreeEntry[]> {
  return fetchJson<FileTreeEntry[]>("/fs/list-directory-entries", {
    query: { path },
  });
}

export async function inspectAttachmentPaths(
  paths: string[],
): Promise<AttachmentPathInfo[]> {
  const response = await fetchJson<{ attachments: AttachmentPathInfo[] }>(
    "/fs/inspect-attachment-paths",
    {
      method: "POST",
      body: { paths },
    },
  );
  return response.attachments ?? [];
}

export async function readImageAttachment(
  path: string,
): Promise<ImageAttachmentPayload> {
  return fetchJson<ImageAttachmentPayload>("/fs/read-image-attachment", {
    query: { path },
  });
}
