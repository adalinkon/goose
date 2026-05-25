import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scanProjectIcons } from "../../api/projects";
import { DEFAULT_PROJECT_ICON } from "../../lib/projectIcons";
import { useProjectIconSelection } from "../useProjectIconSelection";

vi.mock("../../api/projects", () => ({
  scanProjectIcons: vi.fn().mockResolvedValue([]),
}));

describe("useProjectIconSelection", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.mocked(scanProjectIcons).mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("scans project working dirs after a short debounce", async () => {
    vi.mocked(scanProjectIcons).mockResolvedValueOnce([
      {
        id: "/repo/public/logo.svg",
        label: "public/logo.svg",
        icon: "data:image/svg+xml;base64,bG9nbw==",
        sourceDir: "repo",
      },
    ]);

    const { result } = renderHook(() =>
      useProjectIconSelection({
        isOpen: true,
        prompt: "include: /repo",
      }),
    );

    expect(result.current.iconScanPending).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    expect(scanProjectIcons).toHaveBeenCalledWith(["/repo"]);
    expect(result.current.iconCandidates).toHaveLength(1);
    expect(result.current.iconScanPending).toBe(false);
  });

  it("clears scanned candidates when the dialog is closed", () => {
    const { result } = renderHook(() =>
      useProjectIconSelection({
        isOpen: false,
        prompt: "include: /repo",
      }),
    );

    expect(result.current.iconCandidates).toEqual([]);
    expect(result.current.iconScanPending).toBe(false);
    expect(scanProjectIcons).not.toHaveBeenCalled();
  });

  it("resets and chooses icons while clearing icon errors", async () => {
    const { result } = renderHook(() =>
      useProjectIconSelection({
        isOpen: true,
        prompt: "",
      }),
    );

    act(() => {
      result.current.chooseIcon("tabler:code");
    });
    expect(result.current.icon).toBe("tabler:code");

    await act(async () => {
      await result.current.chooseCustomIcon(
        new File(["icon"], "logo.png", { type: "image/png" }),
      );
    });

    expect(result.current.icon).toMatch(/^data:image\/png;base64,/);

    act(() => {
      result.current.resetIcon(null);
    });
    expect(result.current.icon).toBe(DEFAULT_PROJECT_ICON);
  });

  it("surfaces custom icon upload errors", async () => {
    const { result } = renderHook(() =>
      useProjectIconSelection({
        isOpen: true,
        prompt: "",
      }),
    );

    await act(async () => {
      await result.current.chooseCustomIcon(
        new File(["not image"], "icon.txt", { type: "text/plain" }),
      );
    });

    expect(result.current.iconError).toBe("Unsupported icon file type");
  });
});
