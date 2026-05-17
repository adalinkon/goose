import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionEntry } from "../../types";
import { ExtensionsSettings } from "../ExtensionsSettings";

const mockUseExtensionsSettings = vi.fn();

vi.mock("@/features/extensions/hooks/useExtensionsSettings", () => ({
  useExtensionsSettings: () => mockUseExtensionsSettings(),
}));

const extensions: ExtensionEntry[] = [
  {
    type: "stdio",
    name: "github",
    description: "Issue tracker",
    cmd: "npx",
    args: [],
    available_tools: ["search_issues", "create_issue"],
    config_key: "github",
    enabled: true,
  },
  {
    type: "builtin",
    name: "developer",
    display_name: "Developer",
    description: "Code tools",
    config_key: "developer",
    enabled: true,
  },
  {
    type: "platform",
    name: "summarize",
    display_name: "Summarize",
    description: "Summarize files",
    config_key: "summarize",
    enabled: false,
  },
];

describe("ExtensionsSettings", () => {
  beforeEach(() => {
    mockUseExtensionsSettings.mockReturnValue({
      extensions,
      isLoading: false,
      modalMode: null,
      editingExtension: null,
      detailExtension: null,
      handleAdd: vi.fn(),
      handleConfigure: vi.fn(),
      handleShowDetails: vi.fn(),
      handleSubmit: vi.fn(),
      handleDelete: vi.fn(),
      handleToggle: vi.fn(),
      handleUpdateTools: vi.fn(),
      handleModalClose: vi.fn(),
      handleDetailClose: vi.fn(),
      togglingKeys: new Set(),
    });
  });

  it("reveals matching Goose capabilities while searching", async () => {
    const user = userEvent.setup();
    render(<ExtensionsSettings />);

    expect(screen.queryByText("Developer")).not.toBeInTheDocument();

    await user.type(screen.getByRole("searchbox"), "developer");

    expect(screen.getByText("Developer")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: /show .*built-in goose capabilities/i,
      }),
    ).not.toBeInTheDocument();
  });

  it("shows global enable toggles", async () => {
    const user = userEvent.setup();
    render(<ExtensionsSettings />);

    expect(
      screen.getByRole("switch", { name: /disable github/i }),
    ).toBeInTheDocument();

    await user.type(screen.getByRole("searchbox"), "summarize");

    expect(
      screen.getByRole("switch", { name: /enable summarize/i }),
    ).toBeInTheDocument();
  });

  it("opens extension details with configurable tools", async () => {
    const user = userEvent.setup();
    const handleDetailClose = vi.fn();
    const handleUpdateTools = vi.fn().mockResolvedValue(undefined);
    mockUseExtensionsSettings.mockReturnValue({
      extensions,
      isLoading: false,
      modalMode: null,
      editingExtension: null,
      detailExtension: extensions[0],
      handleAdd: vi.fn(),
      handleConfigure: vi.fn(),
      handleShowDetails: vi.fn(),
      handleSubmit: vi.fn(),
      handleDelete: vi.fn(),
      handleToggle: vi.fn(),
      handleUpdateTools,
      handleModalClose: vi.fn(),
      handleDetailClose,
      togglingKeys: new Set(),
    });

    render(<ExtensionsSettings />);

    const dialog = screen.getByRole("dialog", { name: "github" });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText("Issue tracker")).toBeInTheDocument();
    expect(within(dialog).getByText("search_issues")).toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: /create_issue/i }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(handleUpdateTools).toHaveBeenCalledWith(
      extensions[0],
      expect.objectContaining({
        available_tools: ["search_issues"],
      }),
    );
  });
});
