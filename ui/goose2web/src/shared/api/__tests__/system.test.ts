import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getHomeDir,
  inspectAttachmentPaths,
  listDirectoryEntries,
  listFilesForMentions,
  pathExists,
  readImageAttachment,
  saveExportedSessionFile,
} from "../system";

const mockFetchJson = vi.fn();

vi.mock("../gooseServeHttp", () => ({
  fetchJson: (...args: unknown[]) => mockFetchJson(...args),
}));

describe("system API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads home dir", async () => {
    mockFetchJson.mockResolvedValue({ path: "/tmp/home" });

    await expect(getHomeDir()).resolves.toBe("/tmp/home");
    expect(mockFetchJson).toHaveBeenCalledWith("/fs/home-dir");
  });

  it("returns pathExists", async () => {
    mockFetchJson.mockResolvedValue({ exists: true });

    await expect(pathExists("/tmp/a")).resolves.toBe(true);
    expect(mockFetchJson).toHaveBeenCalledWith("/fs/path-exists", {
      query: { path: "/tmp/a" },
    });
  });

  it("maps list and inspect responses", async () => {
    mockFetchJson
      .mockResolvedValueOnce({ files: ["/tmp/a.ts"] })
      .mockResolvedValueOnce([
        { name: "a.ts", path: "/tmp/a.ts", kind: "file" },
      ])
      .mockResolvedValueOnce({
        attachments: [{ name: "a.ts", path: "/tmp/a.ts", kind: "file" }],
      });

    await expect(listFilesForMentions(["/tmp"], 5)).resolves.toEqual([
      "/tmp/a.ts",
    ]);
    await expect(listDirectoryEntries("/tmp")).resolves.toEqual([
      { name: "a.ts", path: "/tmp/a.ts", kind: "file" },
    ]);
    await expect(inspectAttachmentPaths(["/tmp/a.ts"])).resolves.toEqual([
      { name: "a.ts", path: "/tmp/a.ts", kind: "file" },
    ]);
  });

  it("reads image attachment payload", async () => {
    const payload = { base64: "abc", mimeType: "image/png" };
    mockFetchJson.mockResolvedValue(payload);

    await expect(readImageAttachment("/tmp/a.png")).resolves.toEqual(payload);
    expect(mockFetchJson).toHaveBeenCalledWith("/fs/read-image-attachment", {
      query: { path: "/tmp/a.png" },
    });
  });

  it("exports session JSON via browser download flow", async () => {
    const createObjectUrl = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:mock");
    const revokeObjectUrl = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => {});
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    await expect(
      saveExportedSessionFile("session.json", '{"ok":true}'),
    ).resolves.toBe("session.json");

    expect(createObjectUrl).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:mock");
  });
});
