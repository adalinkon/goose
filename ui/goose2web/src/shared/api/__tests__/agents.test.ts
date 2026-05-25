import { describe, it, expect, vi, beforeEach } from "vitest";
import { exportPersona, importPersonas, refreshPersonas } from "../agents";

const mocksourcesExport_unstable = vi.fn();
const mocksourcesImport_unstable = vi.fn();
const mocksourcesList_unstable = vi.fn();

vi.mock("../acpConnection", () => ({
  getClient: vi.fn(async () => ({
    goose: {
      sourcesExport_unstable: (...args: unknown[]) =>
        mocksourcesExport_unstable(...args),
      sourcesImport_unstable: (...args: unknown[]) =>
        mocksourcesImport_unstable(...args),
      sourcesList_unstable: (...args: unknown[]) => mocksourcesList_unstable(...args),
    },
  })),
}));

describe("agents API", () => {
  beforeEach(() => {
    mocksourcesExport_unstable.mockReset();
    mocksourcesImport_unstable.mockReset();
    mocksourcesList_unstable.mockReset();
  });

  it("exportPersona calls ACP sources export", async () => {
    const mockResult = {
      json: '{"displayName":"Test"}',
      filename: "test.agent.json",
    };
    mocksourcesExport_unstable.mockResolvedValue(mockResult);

    const result = await exportPersona("/tmp/persona-123.md");

    expect(mocksourcesExport_unstable).toHaveBeenCalledWith({
      type: "agent",
      path: "/tmp/persona-123.md",
    });
    expect(result).toEqual({
      json: mockResult.json,
      suggestedFilename: mockResult.filename,
    });
  });

  it("importPersonas imports ACP agent sources from JSON payload", async () => {
    mocksourcesImport_unstable.mockResolvedValue({
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

    expect(mocksourcesImport_unstable).toHaveBeenCalledWith({
      data: json,
      global: true,
    });
    expect(result).toHaveLength(1);
    expect(result[0].displayName).toBe("Imported Persona");
  });

  it("refreshPersonas reads from ACP sources list", async () => {
    mocksourcesList_unstable.mockResolvedValue({
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

    expect(mocksourcesList_unstable).toHaveBeenCalledWith({
      type: "agent",
    });
    expect(result).toHaveLength(1);
    expect(result[0].displayName).toBe("Persona One");
  });
});
