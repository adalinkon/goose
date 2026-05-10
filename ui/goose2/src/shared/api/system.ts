import { getClient } from "./acpConnection";

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
  try {
    const client = await getClient();
    const response = await client.extMethod("_goose/system/home_dir", {});
    return response.path as string;
  } catch {
    return "~";
  }
}

export async function saveExportedSessionFile(
  defaultFilename: string,
  contents: string,
): Promise<string | null> {
  const blob = new Blob([contents], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = defaultFilename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    return defaultFilename;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    const client = await getClient();
    const response = await client.extMethod("_goose/system/path_exists", {
      path,
    });
    return response.exists === true;
  } catch {
    return false;
  }
}

export async function listFilesForMentions(
  roots: string[],
  maxResults = 1500,
): Promise<string[]> {
  try {
    const client = await getClient();
    const response = await client.extMethod(
      "_goose/system/list_files_for_mentions",
      {
        roots,
        maxResults,
      },
    );
    return (response.files ?? []) as string[];
  } catch {
    return [];
  }
}

export async function listDirectoryEntries(
  path: string,
): Promise<FileTreeEntry[]> {
  try {
    const client = await getClient();
    const response = await client.extMethod(
      "_goose/system/list_directory_entries",
      {
        path,
      },
    );
    return (response.entries ?? []) as FileTreeEntry[];
  } catch {
    return [];
  }
}

export async function inspectAttachmentPaths(
  paths: string[],
): Promise<AttachmentPathInfo[]> {
  try {
    const client = await getClient();
    const response = await client.extMethod(
      "_goose/system/inspect_attachment_paths",
      {
        paths,
      },
    );
    return (response.attachments ?? []) as AttachmentPathInfo[];
  } catch {
    return [];
  }
}

export async function readImageAttachment(
  path: string,
): Promise<ImageAttachmentPayload> {
  const client = await getClient();
  const response = await client.extMethod(
    "_goose/system/read_image_attachment",
    {
      path,
    },
  );
  return response as unknown as ImageAttachmentPayload;
}
