import type {
  ChangedFile,
  CreatedWorktree,
  GitState,
} from "@/shared/types/git";
import { fetchJson } from "./gooseServeHttp";

export async function getGitState(path: string): Promise<GitState> {
  return fetchJson<GitState>("/git/state", { query: { path } });
}

export async function switchBranch(
  path: string,
  branch: string,
): Promise<void> {
  await fetchJson("/git/switch", {
    method: "POST",
    body: { path, branch },
  });
}

export async function stashChanges(path: string): Promise<void> {
  await fetchJson("/git/stash", { method: "POST", body: { path } });
}

export async function initRepo(path: string): Promise<void> {
  await fetchJson("/git/init", { method: "POST", body: { path } });
}

export async function fetchRepo(path: string): Promise<void> {
  await fetchJson("/git/fetch", { method: "POST", body: { path } });
}

export async function pullRepo(path: string): Promise<void> {
  await fetchJson("/git/pull", { method: "POST", body: { path } });
}

export async function createBranch(
  path: string,
  name: string,
  baseBranch: string,
): Promise<void> {
  await fetchJson("/git/create-branch", {
    method: "POST",
    body: { path, name, baseBranch },
  });
}

export async function getChangedFiles(path: string): Promise<ChangedFile[]> {
  const response = await fetchJson<{ files: ChangedFile[] }>(
    "/git/changed-files",
    {
      query: { path },
    },
  );
  return response.files ?? [];
}

export async function createWorktree(
  path: string,
  name: string,
  branch: string,
  createBranch: boolean,
  baseBranch?: string,
): Promise<CreatedWorktree> {
  return fetchJson<CreatedWorktree>("/git/create-worktree", {
    method: "POST",
    body: {
      path,
      name,
      branch,
      createBranch,
      baseBranch,
    },
  });
}
