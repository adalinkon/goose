import { describe, it, expect, vi, beforeEach } from "vitest";
import { exportPersona, importPersonas, refreshPersonas } from "../agents";

const mockExtMethod = vi.fn();

vi.mock("../acpConnection", () => ({
  getClient: vi.fn(async () => ({
    extMethod: mockExtMethod,
  })),
}));

describe("agents API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── exportPersona ────────────────────────────────────────────────────

  it("exportPersona invokes correct Tauri command with ID", async () => {
    const mockResult = {
      json: '{"displayName":"Test"}',
      suggestedFilename: "test.json",
    };
    mockExtMethod.mockResolvedValue(mockResult);

    const result = await exportPersona("persona-123");

    expect(mockExtMethod).toHaveBeenCalledWith("_goose/personas/export", {
      id: "persona-123",
    });
    expect(result).toEqual(mockResult);
  });

  // ── importPersonas ───────────────────────────────────────────────────

  it("importPersonas invokes correct Tauri command with bytes and filename", async () => {
    const mockPersonas = [
      {
        id: "imported-1",
        displayName: "Imported",
        systemPrompt: "Hello",
        isBuiltin: false,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
    ];
    mockExtMethod.mockResolvedValue({ personas: mockPersonas });

    const fileBytes = [0x7b, 0x7d]; // "{}"
    const result = await importPersonas(fileBytes, "personas.json");

    expect(mockExtMethod).toHaveBeenCalledWith("_goose/personas/import", {
      fileBytes,
      fileName: "personas.json",
    });
    expect(result).toEqual(mockPersonas);
  });

  // ── refreshPersonas ──────────────────────────────────────────────────

  it("refreshPersonas invokes correct Tauri command", async () => {
    const mockPersonas = [
      {
        id: "p1",
        displayName: "Refreshed",
        systemPrompt: "Prompt",
        isBuiltin: false,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
    ];
    mockExtMethod.mockResolvedValue({ personas: mockPersonas });

    const result = await refreshPersonas();

    expect(mockExtMethod).toHaveBeenCalledWith("_goose/personas/refresh", {});
    expect(result).toEqual(mockPersonas);
  });
});
