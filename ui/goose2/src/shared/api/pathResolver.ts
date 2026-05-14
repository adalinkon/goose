import { fetchJson } from "./gooseServeHttp";

export interface ResolvePathParams {
  parts: string[];
}

export interface ResolvedPath {
  path: string;
}

export async function resolvePath({
  parts,
}: ResolvePathParams): Promise<ResolvedPath> {
  return fetchJson<ResolvedPath>("/fs/resolve-path", {
    method: "POST",
    body: { parts },
  });
}
