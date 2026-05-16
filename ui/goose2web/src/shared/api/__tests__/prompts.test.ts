import { beforeEach, describe, expect, it, vi } from "vitest";
import { getPrompt, listPrompts, resetPrompt, savePrompt } from "../prompts";

const mockFetchJson = vi.fn();

vi.mock("../gooseServeHttp", () => ({
  fetchJson: (...args: unknown[]) => mockFetchJson(...args),
}));

describe("prompts API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists prompt templates", async () => {
    const prompts = [
      {
        name: "system.md",
        description: "Main",
        default_content: "default",
        is_customized: false,
      },
    ];
    mockFetchJson.mockResolvedValue({ prompts });

    await expect(listPrompts()).resolves.toEqual(prompts);
    expect(mockFetchJson).toHaveBeenCalledWith("/config/prompts");
  });

  it("gets a prompt by name", async () => {
    mockFetchJson.mockResolvedValue({
      name: "system.md",
      content: "custom",
      default_content: "default",
      is_customized: true,
    });

    await expect(getPrompt("system.md")).resolves.toEqual({
      name: "system.md",
      content: "custom",
      defaultContent: "default",
      isCustomized: true,
    });

    expect(mockFetchJson).toHaveBeenCalledWith("/config/prompts/system.md");
  });

  it("saves prompt content", async () => {
    mockFetchJson.mockResolvedValue("Saved prompt: system.md");

    await savePrompt("system.md", "next");

    expect(mockFetchJson).toHaveBeenCalledWith("/config/prompts/system.md", {
      method: "PUT",
      body: { content: "next" },
    });
  });

  it("resets prompt content", async () => {
    mockFetchJson.mockResolvedValue("Reset prompt to default: system.md");

    await resetPrompt("system.md");

    expect(mockFetchJson).toHaveBeenCalledWith("/config/prompts/system.md", {
      method: "DELETE",
    });
  });
});
