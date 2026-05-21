import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  authenticateAgent,
  checkAgentAuth,
  checkAgentInstalled,
  installAgent,
  onAgentSetupOutput,
} from "./agentSetup";

const mockFetchJson = vi.fn();
const mockBackendFetch = vi.fn();

vi.mock("@/shared/api/gooseServeHttp", () => ({
  fetchJson: (...args: unknown[]) => mockFetchJson(...args),
  backendFetch: (...args: unknown[]) => mockBackendFetch(...args),
}));

describe("agent setup API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("checks installation/auth via REST", async () => {
    mockFetchJson
      .mockResolvedValueOnce({ value: true })
      .mockResolvedValueOnce({ value: true });

    await expect(checkAgentInstalled("foo")).resolves.toBe(true);
    await expect(checkAgentAuth("foo")).resolves.toBe(true);

    expect(mockFetchJson).toHaveBeenNthCalledWith(
      1,
      "/providers/setup/agent/check-installed",
      { query: { providerId: "foo" } },
    );
    expect(mockFetchJson).toHaveBeenNthCalledWith(
      2,
      "/providers/setup/agent/check-auth",
      { query: { providerId: "foo" } },
    );
  });

  it("streams install/authenticate output", async () => {
    const callback = vi.fn();
    await onAgentSetupOutput("foo", callback);

    const streamText = [
      JSON.stringify({ event: "log", providerId: "foo", line: "hello" }),
      JSON.stringify({ event: "done", providerId: "foo", success: true }),
      "",
    ].join("\n");

    mockBackendFetch.mockImplementation(
      () =>
        new Response(streamText, {
          headers: { "content-type": "application/x-ndjson" },
        }),
    );

    await installAgent("foo");
    await authenticateAgent("foo");

    expect(callback).toHaveBeenCalledWith("hello");
    expect(mockBackendFetch).toHaveBeenNthCalledWith(
      1,
      "/providers/setup/agent/install",
      { method: "POST", body: { providerId: "foo" } },
    );
    expect(mockBackendFetch).toHaveBeenNthCalledWith(
      2,
      "/providers/setup/agent/authenticate",
      { method: "POST", body: { providerId: "foo" } },
    );
  });
});
