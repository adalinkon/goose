import { getClient } from "./acpConnection";

export interface ResolvePathParams {
  parts: string[];
}

export interface ResolvedPath {
  path: string;
}

export async function resolvePath({
  parts,
}: ResolvePathParams): Promise<ResolvedPath> {
  try {
    const client = await getClient();
    const response = await client.extMethod("_goose/system/resolve_path", {
      request: { parts },
    });
    return response as unknown as ResolvedPath;
  } catch {
    const normalized = parts.map((part) => part.trim()).filter(Boolean);
    return { path: normalized.join("/") };
  }
}
