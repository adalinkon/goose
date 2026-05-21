import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RecipeInfo } from "../../api/recipes";
import { RecipesView } from "../RecipesView";

type MockProject = {
  id: string;
  name: string;
  workingDirs: string[];
};

let mockProjects: MockProject[] = [
  {
    id: "project-alpha",
    name: "Alpha",
    workingDirs: ["/tmp/alpha"],
  },
];

const mockRecipes: RecipeInfo[] = [
  {
    id: "/config/recipes/daily-review.yaml",
    name: "daily-review",
    title: "Daily Review",
    description: "Review the day",
    content:
      'version: "1.0.0"\ntitle: "Daily Review"\ndescription: "Review the day"\ninstructions: |\n  Review work.\n',
    path: "/config/recipes/daily-review.yaml",
    scope: "global",
    format: "yaml",
    version: "1.0.0",
  },
  {
    id: "/tmp/alpha/.goose/recipes/alpha-check.yaml",
    name: "alpha-check",
    title: "Alpha Check",
    description: "Check Alpha",
    content:
      'version: "1.0.0"\ntitle: "Alpha Check"\ndescription: "Check Alpha"\ninstructions: |\n  Check the project.\n',
    path: "/tmp/alpha/.goose/recipes/alpha-check.yaml",
    scope: "project",
    format: "yaml",
    version: "1.0.0",
  },
];

vi.mock("@/features/projects/stores/projectStore", () => ({
  useProjectStore: (
    selector: (state: { projects: MockProject[] }) => unknown,
  ) => selector({ projects: mockProjects }),
}));

vi.mock("../../api/recipes", () => ({
  listRecipes: vi.fn().mockResolvedValue([]),
  createRecipe: vi.fn(),
  updateRecipe: vi.fn(),
  deleteRecipe: vi.fn().mockResolvedValue(undefined),
  exportRecipe: vi
    .fn()
    .mockResolvedValue({ json: "{}", filename: "daily-review.recipe.json" }),
  importRecipe: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/features/extensions/api/extensions", () => ({
  listExtensions: vi.fn().mockResolvedValue([
    {
      type: "stdio",
      name: "github",
      description: "Issue tracker",
      cmd: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      available_tools: ["search_issues", "create_issue"],
      config_key: "github",
      enabled: true,
    },
  ]),
}));

const { listRecipes, createRecipe, updateRecipe } = (await import(
  "../../api/recipes"
)) as unknown as {
  listRecipes: ReturnType<typeof vi.fn>;
  createRecipe: ReturnType<typeof vi.fn>;
  updateRecipe: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.clearAllMocks();
  mockProjects = [
    {
      id: "project-alpha",
      name: "Alpha",
      workingDirs: ["/tmp/alpha"],
    },
  ];
  listRecipes.mockResolvedValue(mockRecipes);
  createRecipe.mockResolvedValue(mockRecipes[0]);
  updateRecipe.mockResolvedValue(mockRecipes[0]);
});

describe("RecipesView", () => {
  it("loads recipes and renders global plus project filters", async () => {
    render(<RecipesView />);

    await waitFor(() => {
      expect(listRecipes).toHaveBeenCalledWith(["/tmp/alpha"]);
    });

    expect(screen.getByRole("button", { name: "Global" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Alpha" })).toBeInTheDocument();
    expect(screen.getByText("daily-review")).toBeInTheDocument();
    expect(screen.queryByText("alpha-check")).not.toBeInTheDocument();
  });

  it("filters recipes by project", async () => {
    const user = userEvent.setup();
    render(<RecipesView />);

    await screen.findByText("daily-review");
    await user.click(screen.getByRole("button", { name: "Alpha" }));

    expect(screen.getByText("alpha-check")).toBeInTheDocument();
    expect(screen.queryByText("daily-review")).not.toBeInTheDocument();
  });

  it("creates recipes from configured fields", async () => {
    const user = userEvent.setup();
    render(<RecipesView />);

    await screen.findByText("daily-review");
    await user.click(screen.getByRole("button", { name: "New recipe" }));
    await user.clear(screen.getByLabelText(/File name/));
    await user.type(screen.getByLabelText(/File name/), "release-check");
    await user.clear(screen.getByLabelText(/^Title/));
    await user.type(screen.getByLabelText(/^Title/), "Release Check");
    await user.type(
      screen.getByLabelText(/^Description/),
      "Check a release before shipping.",
    );
    await user.type(screen.getByLabelText(/^Instructions/), "Review changes.");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(createRecipe).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "release-check",
        global: true,
        content: expect.stringContaining('title: "Release Check"'),
      }),
    );
  });

  it("adds configured extensions with recipe-specific available tools", async () => {
    const user = userEvent.setup();
    render(<RecipesView />);

    await screen.findByText("daily-review");
    await user.click(screen.getByRole("button", { name: "New recipe" }));
    await user.clear(screen.getByLabelText(/File name/));
    await user.type(screen.getByLabelText(/File name/), "github-review");
    await user.clear(screen.getByLabelText(/^Title/));
    await user.type(screen.getByLabelText(/^Title/), "GitHub Review");
    await user.type(screen.getByLabelText(/^Description/), "Review issues.");
    await user.type(screen.getByLabelText(/^Instructions/), "Use GitHub.");

    await user.click(screen.getByRole("button", { name: "Add extension" }));
    const availableTools = screen.getByLabelText(
      "Available tools, one per line",
    );
    await user.clear(availableTools);
    await user.type(availableTools, "search_issues");

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(createRecipe).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining(
          'extensions: [{"type":"stdio","name":"github"',
        ),
      }),
    );
    expect(createRecipe).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('"available_tools":["search_issues"]'),
      }),
    );
  });

  it("switches between template fields and direct editing without losing edits", async () => {
    const user = userEvent.setup();
    render(<RecipesView />);

    await screen.findByText("daily-review");
    await user.click(screen.getByRole("button", { name: "New recipe" }));
    await user.clear(screen.getByLabelText(/File name/));
    await user.type(screen.getByLabelText(/File name/), "mode-check");
    await user.clear(screen.getByLabelText(/^Title/));
    await user.type(screen.getByLabelText(/^Title/), "Mode Check");
    await user.type(screen.getByLabelText(/^Description/), "Check modes.");
    fireEvent.change(screen.getByLabelText(/^Prompt/), {
      target: { value: "Hello {{ name }}" },
    });

    await user.click(screen.getByRole("button", { name: "Direct edit" }));
    const rawEditor = screen.getByLabelText(
      "Recipe YAML or JSON",
    ) as HTMLTextAreaElement;
    expect(rawEditor.value).toContain('title: "Mode Check"');
    expect(rawEditor.value).toContain("Hello {{ name }}");

    fireEvent.change(rawEditor, {
      target: {
        value:
          'version: "1.0.0"\ntitle: "Raw Mode"\ndescription: "Edited raw content."\nprompt: |\n  Keep {{ topic }}\n',
      },
    });
    await user.click(screen.getByRole("button", { name: "Template fields" }));

    expect(screen.getByLabelText(/^Title/)).toHaveValue("Raw Mode");
    expect(screen.getByLabelText(/^Prompt/)).toHaveValue("Keep {{ topic }}");
  });
});
