import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FilesList } from "../FilesList";
import {
  REMOTE_FILE_OPEN_EVENT,
  type RemoteFileOpenRequest,
} from "@/shared/lib/browserPlatform";

const { mockListDirectoryEntries } = vi.hoisted(() => ({
  mockListDirectoryEntries: vi.fn(),
}));

vi.mock("@/shared/api/system", () => ({
  listDirectoryEntries: mockListDirectoryEntries,
}));

const makeEntry = (overrides: Record<string, unknown> = {}) => ({
  kind: "file" as const,
  name: "README.md",
  path: "/Users/test/project/README.md",
  ...overrides,
});

describe("FilesList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListDirectoryEntries.mockResolvedValue([]);
  });

  it("shows an empty state when no project working directories are available", () => {
    render(<FilesList />);

    expect(
      screen.getByText("Files will show here after you assign a project."),
    ).toBeInTheDocument();
  });

  it("renders separate top-level roots for each working directory", async () => {
    render(
      <FilesList
        projectWorkingDirs={["/Users/test/goose2", "/Users/test/sprout"]}
      />,
    );

    await waitFor(() => {
      expect(mockListDirectoryEntries).toHaveBeenCalledWith(
        "/Users/test/goose2",
      );
      expect(mockListDirectoryEntries).toHaveBeenCalledWith(
        "/Users/test/sprout",
      );
    });

    expect(screen.getByText("goose2")).toBeInTheDocument();
    expect(screen.getByText("sprout")).toBeInTheDocument();
  });

  it("expands folders in place without opening them externally", async () => {
    const user = userEvent.setup();
    mockListDirectoryEntries.mockImplementation((path: string) => {
      if (path === "/Users/test/project") {
        return Promise.resolve([
          makeEntry({
            kind: "directory",
            name: "src",
            path: "/Users/test/project/src",
          }),
        ]);
      }

      if (path === "/Users/test/project/src") {
        return Promise.resolve([
          makeEntry({
            name: "App.tsx",
            path: "/Users/test/project/src/App.tsx",
          }),
        ]);
      }

      return Promise.resolve([]);
    });

    render(<FilesList projectWorkingDirs={["/Users/test/project"]} />);

    await screen.findByText("src");
    await user.click(screen.getByText("src"));

    await waitFor(() => {
      expect(mockListDirectoryEntries).toHaveBeenCalledWith(
        "/Users/test/project/src",
      );
    });
    expect(screen.getByText("App.tsx")).toBeInTheDocument();
  });

  it("selects files in the browser file tree when a file is clicked", async () => {
    const user = userEvent.setup();
    mockListDirectoryEntries.mockResolvedValue([
      makeEntry({
        name: "README.md",
        path: "/Users/test/project/README.md",
      }),
    ]);

    render(<FilesList projectWorkingDirs={["/Users/test/project"]} />);

    await user.click(await screen.findByText("README.md"));

    expect(
      screen.getByText("README.md").closest('[role="treeitem"]'),
    ).toHaveClass("bg-muted");
  });

  it("supports copy-path context menu actions for folders and files", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText,
      },
    });
    mockListDirectoryEntries.mockResolvedValue([
      makeEntry({
        kind: "directory",
        name: "src",
        path: "/Users/test/project/src",
      }),
      makeEntry({
        name: "README.md",
        path: "/Users/test/project/README.md",
      }),
    ]);

    render(<FilesList projectWorkingDirs={["/Users/test/project"]} />);

    const folderLabel = await screen.findByText("src");
    fireEvent.contextMenu(folderLabel);
    await user.click(
      screen.getByRole("menuitem", {
        name: /copy path/i,
      }),
    );
    expect(writeText).toHaveBeenCalledWith("/Users/test/project/src");

    const fileLabel = screen.getByText("README.md");
    fireEvent.contextMenu(fileLabel);
    await user.click(
      screen.getByRole("menuitem", {
        name: /copy path/i,
      }),
    );
    expect(writeText).toHaveBeenCalledWith("/Users/test/project/README.md");
  });

  it("opens a remote file request by expanding and selecting it in the tree", async () => {
    mockListDirectoryEntries.mockImplementation((path: string) => {
      if (path === "/Users/test/project") {
        return Promise.resolve([
          makeEntry({
            kind: "directory",
            name: "src",
            path: "/Users/test/project/src",
          }),
        ]);
      }

      if (path === "/Users/test/project/src") {
        return Promise.resolve([
          makeEntry({
            name: "App.tsx",
            path: "/Users/test/project/src/App.tsx",
          }),
        ]);
      }

      return Promise.resolve([]);
    });

    render(<FilesList projectWorkingDirs={["/Users/test/project"]} />);

    await screen.findByText("src");

    const resolve = vi.fn();
    const reject = vi.fn();
    window.dispatchEvent(
      new CustomEvent<RemoteFileOpenRequest>(REMOTE_FILE_OPEN_EVENT, {
        detail: {
          path: "/Users/test/project/src/App.tsx",
          reject,
          resolve,
        },
      }),
    );

    await waitFor(() => {
      expect(resolve).toHaveBeenCalled();
    });
    expect(reject).not.toHaveBeenCalled();
    expect(screen.getByText("App.tsx")).toBeInTheDocument();
    expect(
      screen.getByText("App.tsx").closest('[role="treeitem"]'),
    ).toHaveClass("bg-muted");
  });
});
