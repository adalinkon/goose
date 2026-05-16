import { describe, it, expect, vi, beforeEach } from "vitest";
import { exportPersona, importPersonas, refreshPersonas } from "../agents";

const mockGooseSourcesExport = vi.fn();
const mockGooseSourcesImport = vi.fn();
const mockGooseSourcesList = vi.fn();

vi.mock("../acpConnection", () => ({
  getClient: vi.fn(async () => ({
    goose: {
      GooseSourcesExport: (...args: unknown[]) =>
        mockGooseSourcesExport(...args),
      GooseSourcesImport: (...args: unknown[]) =>
        mockGooseSourcesImport(...args),
      GooseSourcesList: (...args: unknown[]) => mockGooseSourcesList(...args),
    },
  })),
}));

describe("agents API", () => {
  beforeEach(() => {
    mockGooseSourcesExport.mockReset();
    mockGooseSourcesImport.mockReset();
    mockGooseSourcesList.mockReset();
  });

  it("exportPersona calls ACP sources export", async () => {
    const mockResult = {
      json: '{"displayName":"Test"}',
      filename: "test.agent.json",
    };
    mockGooseSourcesExport.mockResolvedValue(mockResult);

    const result = await exportPersona("/tmp/persona-123.md");

    expect(mockGooseSourcesExport).toHaveBeenCalledWith({
      type: "agent",
      path: "/tmp/persona-123.md",
    });
    expect(result).toEqual({
      json: mockResult.json,
      suggestedFilename: mockResult.filename,
    });
  });

  it("importPersonas imports ACP agent sources from JSON payload", async () => {
    mockGooseSourcesImport.mockResolvedValue({
      sources: [
        {
          type: "agent",
          name: "Imported Persona",
          description: "",
          content: "You are imported.",
          path: "/tmp/imported.md",
          global: true,
          writable: true,
          properties: {},
        },
      ],
    });

    const json = JSON.stringify({
      version: 1,
      type: "agent",
      name: "Imported Persona",
      description: "",
      content: "You are imported.",
    });
    const fileBytes = Array.from(new TextEncoder().encode(json));
    const result = await importPersonas(fileBytes, "personas.json");

    expect(mockGooseSourcesImport).toHaveBeenCalledWith({
      data: json,
      global: true,
    });
    expect(result).toHaveLength(1);
    expect(result[0].displayName).toBe("Imported Persona");
  });

  it("refreshPersonas reads from ACP sources list", async () => {
    mockGooseSourcesList.mockResolvedValue({
      sources: [
        {
          type: "agent",
          name: "Persona One",
          description: "",
          content: "Prompt",
          path: "/tmp/p1.md",
          global: true,
          writable: true,
          properties: {},
        },
      ],
    });

    const result = await refreshPersonas();

    expect(mockGooseSourcesList).toHaveBeenCalledWith({
      type: "agent",
    });
    expect(result).toHaveLength(1);
    expect(result[0].displayName).toBe("Persona One");
  });
});
