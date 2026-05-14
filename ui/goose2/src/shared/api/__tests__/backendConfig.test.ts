import { beforeEach, describe, expect, it } from "vitest";
import {
  getActiveBackendServerAuth,
  getActiveBackendServerName,
  getActiveBackendServerUrl,
  getStoredBackendUrl,
  resolveBackendServerUrl,
  setActiveBackendServerName,
  setBackendServerAuth,
  setBackendServer,
} from "../backendConfig";

describe("backendConfig URL resolution", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("auto-completes host:port to ws://.../acp", () => {
    expect(resolveBackendServerUrl("localhost:3284")).toBe(
      "ws://localhost:3284/acp",
    );
    expect(resolveBackendServerUrl("127.0.0.1:3284")).toBe(
      "ws://127.0.0.1:3284/acp",
    );
  });

  it("normalizes http(s) schemes to ws(s)", () => {
    expect(resolveBackendServerUrl("http://localhost:3284")).toBe(
      "ws://localhost:3284/acp",
    );
    expect(resolveBackendServerUrl("https://example.com")).toBe(
      "wss://example.com/acp",
    );
  });

  it("keeps explicit paths when provided", () => {
    expect(resolveBackendServerUrl("wss://example.com/custom-path")).toBe(
      "wss://example.com/custom-path",
    );
  });

  it("returns null for unsupported schemes", () => {
    expect(resolveBackendServerUrl("ftp://localhost:3284")).toBeNull();
  });

  it("resolves active server URL at read time while preserving raw stored input", () => {
    setBackendServer("local", "127.0.0.1:3284");
    setActiveBackendServerName("local");

    expect(getStoredBackendUrl()).toBe("127.0.0.1:3284");
    expect(getActiveBackendServerUrl()).toBe("ws://127.0.0.1:3284/acp");
  });

  it("falls back to first server when active server is missing", () => {
    setBackendServer("local", "localhost:3284");

    expect(getActiveBackendServerName()).toBe("local");
    expect(getActiveBackendServerUrl()).toBe("ws://localhost:3284/acp");
  });

  it("returns active server auth payload", () => {
    setBackendServer("local", "localhost:3284");
    setActiveBackendServerName("local");
    setBackendServerAuth("local", { username: "demo", token: "secret" });

    expect(getActiveBackendServerAuth()).toEqual({
      username: "demo",
      token: "secret",
    });
  });
});
