import { getClient } from "./acpConnection";
import type {
  ChangedFile,
  CreatedWorktree,
  GitState,
} from "@/shared/types/git";

export async function getGitState(path: string): Promise<GitState> {
  try {
    const client = await getClient();
    const response = await client.extMethod("_goose/git/state", { path });
    return response as unknown as GitState;
  } catch {
    return {
      isGitRepo: false,
      currentBranch: null,
      dirtyFileCount: 0,
      incomingCommitCount: 0,
      worktrees: [],
      isWorktree: false,
      mainWorktreePath: null,
      localBranches: [],
    };
  }
}

export async function switchBranch(
  path: string,
  branch: string,
): Promise<void> {
  const client = await getClient();
  await client.extMethod("_goose/git/switch_branch", { path, branch });
}

export async function stashChanges(path: string): Promise<void> {
  const client = await getClient();
  await client.extMethod("_goose/git/stash", { path });
}

export async function initRepo(path: string): Promise<void> {
  const client = await getClient();
  await client.extMethod("_goose/git/init", { path });
}

export async function fetchRepo(path: string): Promise<void> {
  const client = await getClient();
  await client.extMethod("_goose/git/fetch", { path });
}

export async function pullRepo(path: string): Promise<void> {
  const client = await getClient();
  await client.extMethod("_goose/git/pull", { path });
}

export async function createBranch(
  path: string,
  name: string,
  baseBranch: string,
): Promise<void> {
  const client = await getClient();
  await client.extMethod("_goose/git/create_branch", {
    path,
    name,
    baseBranch,
  });
}

export async function getChangedFiles(path: string): Promise<ChangedFile[]> {
  try {
    const client = await getClient();
    const response = await client.extMethod("_goose/git/changed_files", {
      path,
    });
    return (response.files ?? []) as ChangedFile[];
  } catch {
    return [];
  }
}

export async function createWorktree(
  path: string,
  name: string,
  branch: string,
  createBranch: boolean,
  baseBranch?: string,
): Promise<CreatedWorktree> {
  const client = await getClient();
  const response = await client.extMethod("_goose/git/create_worktree", {
    path,
    name,
    branch,
    createBranch,
    baseBranch,
  });
  return response as unknown as CreatedWorktree;
}
