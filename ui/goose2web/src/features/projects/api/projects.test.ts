import { beforeEach, describe, expect, it, vi } from "vitest";
import { readProjectIcon, scanProjectIcons } from "./projects";

const mockFetchJson = vi.fn();

vi.mock("@/shared/api/gooseServeHttp", () => ({
  fetchJson: (...args: unknown[]) => mockFetchJson(...args),
}));

vi.mock("@/shared/api/acpConnection", () => ({
  getClient: vi.fn(async () => ({
    extMethod: vi.fn(),
  })),
}));

describe("projects API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("scans project icons through REST", async () => {
    const icons = [
      {
        id: "logo",
        label: "logo",
        icon: "data:image/png;base64,abc",
        sourceDir: "/tmp/project",
      },
    ];
    mockFetchJson.mockResolvedValue({ icons });

    await expect(scanProjectIcons(["/tmp/project"])).resolves.toEqual(icons);
    expect(mockFetchJson).toHaveBeenCalledWith("/fs/project-icons/scan", {
      method: "POST",
      body: { workingDirs: ["/tmp/project"] },
    });
  });

  it("reads one project icon through REST", async () => {
    const iconPayload = {
      icon: "data:image/png;base64,xyz",
    };
    mockFetchJson.mockResolvedValue(iconPayload);

    await expect(readProjectIcon("/tmp/project/icon.png")).resolves.toEqual(
      iconPayload,
    );
    expect(mockFetchJson).toHaveBeenCalledWith("/fs/project-icons/read", {
      query: { path: "/tmp/project/icon.png" },
    });
  });
});
