import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ServersDialog } from "../ServersDialog";

const backendConfigMocks = vi.hoisted(() => ({
  getActiveBackendServerName: vi.fn(),
  getBackendServerAuth: vi.fn(),
  getBackendServers: vi.fn(),
  removeBackendServer: vi.fn(),
  resolveBackendServerUrl: vi.fn((url: string) => url),
  setActiveBackendServerName: vi.fn(),
  setBackendServer: vi.fn(),
  setBackendServerAuth: vi.fn(),
}));

vi.mock("@/shared/api/backendConfig", () => backendConfigMocks);

const backendConnectionMocks = vi.hoisted(() => ({
  checkBackendServerConnection: vi.fn(async () => true),
}));

vi.mock("@/shared/api/backendConnection", () => backendConnectionMocks);

describe("ServersDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    backendConfigMocks.getBackendServers.mockReturnValue({
      alpha: "127.0.0.1:3000",
      beta: "127.0.0.1:4000",
    });
    backendConfigMocks.getActiveBackendServerName.mockReturnValue("alpha");
    backendConfigMocks.getBackendServerAuth.mockImplementation(
      (name: string) => ({
        username: name === "alpha" ? "alice" : "bob",
        token: name === "alpha" ? "a-token" : "b-token",
      }),
    );
  });

  it("shows an edit button and allows updating an existing server", async () => {
    const user = userEvent.setup();
    render(<ServersDialog open onOpenChange={vi.fn()} />);

    const editButtons = await screen.findAllByRole("button", {
      name: /edit server/i,
    });
    expect(editButtons.length).toBeGreaterThan(0);

    await user.click(editButtons[0]);
    expect(screen.getByRole("heading", { name: /edit server/i })).toBeVisible();
    expect(screen.getByDisplayValue("alpha")).toBeVisible();
    expect(screen.getByDisplayValue("127.0.0.1:3000")).toBeVisible();
    expect(screen.getByDisplayValue("alice")).toBeVisible();

    const serverNameInput = screen.getByDisplayValue("alpha");
    const serverAddressInput = screen.getByDisplayValue("127.0.0.1:3000");
    const usernameInput = screen.getByDisplayValue("alice");
    const tokenInput = screen.getByDisplayValue("a-token");

    await user.clear(serverNameInput);
    await user.type(serverNameInput, "alpha-renamed");
    await user.clear(serverAddressInput);
    await user.type(serverAddressInput, "127.0.0.1:3555");
    await user.clear(usernameInput);
    await user.type(usernameInput, "carol");
    await user.clear(tokenInput);
    await user.type(tokenInput, "new-token");
    await user.click(screen.getByRole("button", { name: /save server/i }));

    expect(backendConfigMocks.removeBackendServer).toHaveBeenCalledWith(
      "alpha",
    );
    expect(backendConfigMocks.setBackendServer).toHaveBeenCalledWith(
      "alpha-renamed",
      "127.0.0.1:3555",
    );
    expect(backendConfigMocks.setBackendServerAuth).toHaveBeenCalledWith(
      "alpha-renamed",
      {
        username: "carol",
        token: "new-token",
      },
    );
    expect(backendConfigMocks.setActiveBackendServerName).toHaveBeenCalledWith(
      "alpha-renamed",
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /add server/i })).toBeVisible();
    });
  });
});
