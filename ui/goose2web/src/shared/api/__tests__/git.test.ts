import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createBranch,
  createWorktree,
  fetchRepo,
  getChangedFiles,
  getGitState,
  initRepo,
  pullRepo,
  stashChanges,
  switchBranch,
} from "../git";

const mockFetchJson = vi.fn();

vi.mock("../gooseServeHttp", () => ({
  fetchJson: (...args: unknown[]) => mockFetchJson(...args),
}));

describe("git API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps git state", async () => {
    const state = {
      isGitRepo: true,
      currentBranch: "main",
      dirtyFileCount: 2,
      incomingCommitCount: 0,
      worktrees: [],
      isWorktree: false,
      mainWorktreePath: null,
      localBranches: ["main"],
    };
    mockFetchJson.mockResolvedValue(state);

    await expect(getGitState("/repo")).resolves.toEqual(state);
    expect(mockFetchJson).toHaveBeenCalledWith("/git/state", {
      query: { path: "/repo" },
    });
  });

  it("maps command-style git calls", async () => {
    mockFetchJson.mockResolvedValue({});

    await switchBranch("/repo", "feature/x");
    await stashChanges("/repo");
    await initRepo("/repo");
    await fetchRepo("/repo");
    await pullRepo("/repo");
    await createBranch("/repo", "feature/y", "main");

    expect(mockFetchJson).toHaveBeenNthCalledWith(1, "/git/switch", {
      method: "POST",
      body: { path: "/repo", branch: "feature/x" },
    });
    expect(mockFetchJson).toHaveBeenNthCalledWith(2, "/git/stash", {
      method: "POST",
      body: { path: "/repo" },
    });
    expect(mockFetchJson).toHaveBeenNthCalledWith(3, "/git/init", {
      method: "POST",
      body: { path: "/repo" },
    });
    expect(mockFetchJson).toHaveBeenNthCalledWith(4, "/git/fetch", {
      method: "POST",
      body: { path: "/repo" },
    });
    expect(mockFetchJson).toHaveBeenNthCalledWith(5, "/git/pull", {
      method: "POST",
      body: { path: "/repo" },
    });
    expect(mockFetchJson).toHaveBeenNthCalledWith(6, "/git/create-branch", {
      method: "POST",
      body: { path: "/repo", name: "feature/y", baseBranch: "main" },
    });
  });

  it("maps changed files response", async () => {
    mockFetchJson.mockResolvedValueOnce({
      files: [{ path: "src/a.ts", status: "modified" }],
    });

    await expect(getChangedFiles("/repo")).resolves.toEqual([
      { path: "src/a.ts", status: "modified" },
    ]);
  });

  it("returns created worktree payload", async () => {
    const created = { path: "/repo-wt", branch: "feature/z" };
    mockFetchJson.mockResolvedValue(created);

    await expect(
      createWorktree("/repo", "wt", "feature/z", true, "main"),
    ).resolves.toEqual(created);
    expect(mockFetchJson).toHaveBeenCalledWith("/git/create-worktree", {
      method: "POST",
      body: {
        path: "/repo",
        name: "wt",
        branch: "feature/z",
        createBranch: true,
        baseBranch: "main",
      },
    });
  });
});
