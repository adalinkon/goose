import { describe, expect, it, vi } from "vitest";
import { getGooseServeHostInfo } from "../gooseServeHost";

const mockGetActiveBackendServerUrl = vi.fn();
const mockGetActiveBackendServerAuth = vi.fn();

vi.mock("../backendConfig", () => ({
  getActiveBackendServerUrl: () => mockGetActiveBackendServerUrl(),
  getActiveBackendServerAuth: () => mockGetActiveBackendServerAuth(),
}));

describe("gooseServeHost API", () => {
  it("maps websocket ACP URL to HTTP base URL", async () => {
    mockGetActiveBackendServerUrl.mockReturnValue("ws://localhost:3284/acp");
    mockGetActiveBackendServerAuth.mockReturnValue({ username: "", token: "" });

    await expect(getGooseServeHostInfo()).resolves.toEqual({
      httpBaseUrl: "http://localhost:3284",
      secretKey: "",
    });
  });

  it("preserves non-acp path prefix for proxy base URL", async () => {
    mockGetActiveBackendServerUrl.mockReturnValue(
      "wss://example.com/custom-prefix/acp",
    );
    mockGetActiveBackendServerAuth.mockReturnValue({
      username: "demo",
      token: "top-secret",
    });

    await expect(getGooseServeHostInfo()).resolves.toEqual({
      httpBaseUrl: "https://example.com/custom-prefix",
      secretKey: "top-secret",
    });
  });

  it("throws when no backend server URL is configured", async () => {
    mockGetActiveBackendServerUrl.mockReturnValue(null);
    mockGetActiveBackendServerAuth.mockReturnValue(null);

    await expect(getGooseServeHostInfo()).rejects.toThrow(
      "No backend URL configured",
    );
  });
});
