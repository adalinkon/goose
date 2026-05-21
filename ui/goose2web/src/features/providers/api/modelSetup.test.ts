import { describe, expect, it, vi } from "vitest";
import { authenticateModelProvider, onModelSetupOutput } from "./modelSetup";

const mockBackendFetch = vi.fn();

vi.mock("@/shared/api/gooseServeHttp", () => ({
  backendFetch: (...args: unknown[]) => mockBackendFetch(...args),
}));

describe("model setup API", () => {
  it("authenticates through REST streaming", async () => {
    const callback = vi.fn();
    await onModelSetupOutput("openai", callback);

    const streamText = [
      JSON.stringify({ event: "log", providerId: "openai", line: "step" }),
      JSON.stringify({ event: "done", providerId: "openai", success: true }),
      "",
    ].join("\n");

    mockBackendFetch.mockResolvedValue(
      new Response(streamText, {
        headers: { "content-type": "application/x-ndjson" },
      }),
    );

    await expect(
      authenticateModelProvider("openai", "OpenAI"),
    ).resolves.toBeUndefined();
    expect(callback).toHaveBeenCalledWith("step");
    expect(mockBackendFetch).toHaveBeenCalledWith(
      "/providers/setup/model/authenticate",
      {
        method: "POST",
        body: {
          providerId: "openai",
          providerLabel: "OpenAI",
        },
      },
    );
  });
});
