import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkBackendServerConnection } from "../backendConnection";

const mockResolveBackendServerUrl = vi.fn();

vi.mock("../backendConfig", () => ({
  resolveBackendServerUrl: (url: string) => mockResolveBackendServerUrl(url),
}));

class MockSocket extends EventTarget {
  static instances: MockSocket[] = [];
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readonly url: string;
  readyState = MockSocket.CONNECTING;
  closeCalls = 0;

  constructor(url: string) {
    super();
    this.url = url;
    MockSocket.instances.push(this);
  }

  emitOpen() {
    this.readyState = MockSocket.OPEN;
    this.dispatchEvent(new Event("open"));
  }

  emitError() {
    this.dispatchEvent(new Event("error"));
  }

  emitClose() {
    this.readyState = MockSocket.CLOSED;
    this.dispatchEvent(new Event("close"));
  }

  close() {
    this.closeCalls += 1;
    this.readyState = MockSocket.CLOSED;
  }
}

describe("backendConnection API", () => {
  const originalWebSocket = globalThis.WebSocket;

  beforeEach(() => {
    MockSocket.instances = [];
    mockResolveBackendServerUrl.mockReset();
    globalThis.WebSocket = MockSocket as unknown as typeof WebSocket;
  });

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket;
  });

  it("returns false when backend URL cannot be resolved", async () => {
    mockResolveBackendServerUrl.mockReturnValue(null);
    await expect(checkBackendServerConnection("bad-url")).resolves.toBe(false);
  });

  it("returns true when websocket opens", async () => {
    mockResolveBackendServerUrl.mockReturnValue("ws://localhost:3284/acp");

    const connection = checkBackendServerConnection("localhost:3284");
    const socket = MockSocket.instances[0];
    socket.emitOpen();

    await expect(connection).resolves.toBe(true);
    expect(socket.closeCalls).toBe(1);
  });

  it("returns false when websocket errors or closes", async () => {
    mockResolveBackendServerUrl.mockReturnValue("ws://localhost:3284/acp");

    const connectionError = checkBackendServerConnection("localhost:3284");
    MockSocket.instances[0].emitError();
    await expect(connectionError).resolves.toBe(false);

    const connectionClose = checkBackendServerConnection("localhost:3284");
    MockSocket.instances[1].emitClose();
    await expect(connectionClose).resolves.toBe(false);
  });
});
