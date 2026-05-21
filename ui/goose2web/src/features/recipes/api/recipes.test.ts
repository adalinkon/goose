import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGooseSourcesList = vi.fn();
const mockGooseSourcesCreate = vi.fn();
const mockGooseSourcesUpdate = vi.fn();

vi.mock("@/shared/api/acpConnection", () => ({
  getClient: async () => ({
    goose: {
      GooseSourcesList: (...args: unknown[]) => mockGooseSourcesList(...args),
      GooseSourcesCreate: (...args: unknown[]) =>
        mockGooseSourcesCreate(...args),
      GooseSourcesUpdate: (...args: unknown[]) =>
        mockGooseSourcesUpdate(...args),
    },
  }),
}));

describe("recipes API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("maps recipe SourceEntry metadata", async () => {
    mockGooseSourcesList.mockResolvedValueOnce({
      sources: [
        {
          type: "recipe",
          name: "daily-review",
          description: "Review work",
          content: "version: 1.0.0\ntitle: Daily Review\n",
          path: "/tmp/config/recipes/daily-review.yaml",
          global: true,
          writable: true,
          properties: {
            title: "Daily Review",
            version: "1.0.0",
            format: "yaml",
          },
        },
      ],
    });

    const { listRecipes } = await import("./recipes");
    const recipes = await listRecipes();

    expect(mockGooseSourcesList).toHaveBeenCalledWith({ type: "recipe" });
    expect(recipes).toEqual([
      expect.objectContaining({
        name: "daily-review",
        title: "Daily Review",
        description: "Review work",
        content: "version: 1.0.0\ntitle: Daily Review\n",
        scope: "global",
        format: "yaml",
        version: "1.0.0",
      }),
    ]);
  });

  it("passes projectDir for project recipe listings and creation", async () => {
    mockGooseSourcesList
      .mockResolvedValueOnce({ sources: [] })
      .mockResolvedValueOnce({
        sources: [
          {
            type: "recipe",
            name: "project-recipe",
            description: "Project recipe",
            content: "version: 1.0.0\ntitle: Project\ninstructions: Go\n",
            path: "/tmp/project/.goose/recipes/project-recipe.yaml",
            global: false,
            writable: true,
            properties: { title: "Project", version: "1.0.0", format: "yaml" },
          },
        ],
      });
    mockGooseSourcesCreate.mockResolvedValueOnce({
      source: {
        type: "recipe",
        name: "new-recipe",
        description: "New",
        content: "version: 1.0.0\ntitle: New\ninstructions: Go\n",
        path: "/tmp/project/.goose/recipes/new-recipe.yaml",
        global: false,
        writable: true,
        properties: { title: "New", version: "1.0.0", format: "yaml" },
      },
    });

    const { createRecipe, listRecipes } = await import("./recipes");
    const recipes = await listRecipes(["/tmp/project"]);
    const created = await createRecipe({
      name: "new-recipe",
      content: "version: 1.0.0\ntitle: New\ninstructions: Go\n",
      global: false,
      projectDir: "/tmp/project",
    });

    expect(mockGooseSourcesList).toHaveBeenNthCalledWith(2, {
      type: "recipe",
      projectDir: "/tmp/project",
    });
    expect(mockGooseSourcesCreate).toHaveBeenCalledWith({
      type: "recipe",
      name: "new-recipe",
      description: "",
      content: "version: 1.0.0\ntitle: New\ninstructions: Go\n",
      global: false,
      projectDir: "/tmp/project",
    });
    expect(recipes[0].scope).toBe("project");
    expect(created.scope).toBe("project");
  });

  it("keeps global recipes when a project recipe listing fails", async () => {
    mockGooseSourcesList
      .mockResolvedValueOnce({
        sources: [
          {
            type: "recipe",
            name: "global-recipe",
            description: "Global recipe",
            content: "version: 1.0.0\ntitle: Global\ninstructions: Go\n",
            path: "/tmp/config/recipes/global-recipe.yaml",
            global: true,
            writable: true,
            properties: { title: "Global", version: "1.0.0", format: "yaml" },
          },
        ],
      })
      .mockRejectedValueOnce(new Error("project unavailable"));

    const { listRecipes } = await import("./recipes");
    const recipes = await listRecipes(["/tmp/project"]);

    expect(mockGooseSourcesList).toHaveBeenCalledTimes(2);
    expect(recipes).toEqual([
      expect.objectContaining({
        name: "global-recipe",
        scope: "global",
      }),
    ]);
  });

  it("updates recipes through GooseSourcesUpdate", async () => {
    mockGooseSourcesUpdate.mockResolvedValueOnce({
      source: {
        type: "recipe",
        name: "renamed",
        description: "Updated",
        content: "version: 1.0.0\ntitle: Updated\ninstructions: Go\n",
        path: "/tmp/config/recipes/renamed.yaml",
        global: true,
        writable: true,
        properties: { title: "Updated", version: "1.0.0", format: "yaml" },
      },
    });

    const { updateRecipe } = await import("./recipes");
    const updated = await updateRecipe({
      path: "/tmp/config/recipes/original.yaml",
      name: "renamed",
      content: "version: 1.0.0\ntitle: Updated\ninstructions: Go\n",
    });

    expect(mockGooseSourcesUpdate).toHaveBeenCalledWith({
      type: "recipe",
      path: "/tmp/config/recipes/original.yaml",
      name: "renamed",
      description: "",
      content: "version: 1.0.0\ntitle: Updated\ninstructions: Go\n",
    });
    expect(updated.name).toBe("renamed");
  });
});
