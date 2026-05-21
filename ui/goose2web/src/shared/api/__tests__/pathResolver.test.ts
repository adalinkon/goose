import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolvePath } from "../pathResolver";

const mockFetchJson = vi.fn();

vi.mock("../gooseServeHttp", () => ({
  fetchJson: (...args: unknown[]) => mockFetchJson(...args),
}));

describe("pathResolver API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("delegates path resolution", async () => {
    mockFetchJson.mockResolvedValue({ path: "/tmp/project/src" });

    await expect(
      resolvePath({ parts: ["/tmp/project", "src"] }),
    ).resolves.toEqual({ path: "/tmp/project/src" });
    expect(mockFetchJson).toHaveBeenCalledWith("/fs/resolve-path", {
      method: "POST",
      body: { parts: ["/tmp/project", "src"] },
    });
  });
});
