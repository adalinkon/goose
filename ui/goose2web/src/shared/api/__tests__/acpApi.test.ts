import { beforeEach, describe, expect, it, vi } from "vitest";
import { listSessions } from "../acpApi";

const mocks = vi.hoisted(() => ({
  listSessions: vi.fn(),
  getClient: vi.fn(),
}));

vi.mock("../acpConnection", () => ({
  getClient: () => mocks.getClient(),
}));

describe("acpApi listSessions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getClient.mockResolvedValue({
      listSessions: mocks.listSessions,
    });
    mocks.listSessions.mockResolvedValue({ sessions: [] });
  });

  it("requests active sessions by default through goose meta", async () => {
    await listSessions();

    expect(mocks.listSessions).toHaveBeenCalledWith({
      _meta: {
        goose: {
          includeArchived: false,
        },
      },
    });
  });

  it("can request archived sessions through goose meta", async () => {
    await listSessions({ includeArchived: true });

    expect(mocks.listSessions).toHaveBeenCalledWith({
      _meta: {
        goose: {
          includeArchived: true,
        },
      },
    });
  });
});
