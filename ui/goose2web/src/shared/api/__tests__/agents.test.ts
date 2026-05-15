import { describe, it, expect, vi, beforeEach } from "vitest";
import { exportPersona, importPersonas, refreshPersonas } from "../agents";

const mockFetchJson = vi.fn();

vi.mock("../gooseServeHttp", () => ({
  fetchJson: (...args: unknown[]) => mockFetchJson(...args),
}));

describe("agents API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exportPersona calls REST endpoint", async () => {
    const mockResult = {
      json: '{"displayName":"Test"}',
      suggestedFilename: "test.json",
    };
    mockFetchJson.mockResolvedValue(mockResult);

    const result = await exportPersona("persona-123");

    expect(mockFetchJson).toHaveBeenCalledWith("/personas/persona-123/export");
    expect(result).toEqual(mockResult);
  });

  it("importPersonas posts bytes and filename", async () => {
    const mockPersonas = [{ id: "imported-1" }];
    mockFetchJson.mockResolvedValue(mockPersonas);

    const fileBytes = [0x7b, 0x7d];
    const result = await importPersonas(fileBytes, "personas.json");

    expect(mockFetchJson).toHaveBeenCalledWith("/personas/import", {
      method: "POST",
      body: {
        fileBytes,
        fileName: "personas.json",
      },
    });
    expect(result).toEqual(mockPersonas);
  });

  it("refreshPersonas posts refresh endpoint", async () => {
    const mockPersonas = [{ id: "p1" }];
    mockFetchJson.mockResolvedValue(mockPersonas);

    const result = await refreshPersonas();

    expect(mockFetchJson).toHaveBeenCalledWith("/personas/refresh", {
      method: "POST",
    });
    expect(result).toEqual(mockPersonas);
  });
});
