import type { ProjectInfo } from "@/features/projects/api/projects";
import type { RecipeInfo } from "../api/recipes";

export interface RecipeProjectOption {
  id: string;
  name: string;
  workingDir: string;
}

export type RecipeFilter = "global" | `project:${string}`;

export function recipeProjectOptions(
  projects: ProjectInfo[],
): RecipeProjectOption[] {
  return projects.flatMap((project) => {
    const workingDir = project.workingDirs[0]?.trim();
    return workingDir
      ? [
          {
            id: project.id,
            name: project.name || workingDir,
            workingDir,
          },
        ]
      : [];
  });
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

export function getRecipeProject(
  recipe: RecipeInfo,
  projects: RecipeProjectOption[],
): RecipeProjectOption | null {
  if (recipe.scope === "global") return null;
  const recipePath = normalizePath(recipe.path);
  return (
    projects.find((project) =>
      recipePath.startsWith(`${normalizePath(project.workingDir)}/`),
    ) ?? null
  );
}

export function getRecipeScopeLabel(
  recipe: RecipeInfo,
  projects: RecipeProjectOption[],
  labels: { global: string; projectFallback: string },
): string {
  if (recipe.scope === "global") return labels.global;
  return getRecipeProject(recipe, projects)?.name ?? labels.projectFallback;
}

export function filterRecipes(
  recipes: RecipeInfo[],
  filters: {
    search: string;
    activeFilter: RecipeFilter;
    projects: RecipeProjectOption[];
  },
): RecipeInfo[] {
  const searchTerm = filters.search.trim().toLowerCase();
  return recipes.filter((recipe) => {
    const scopeLabel = getRecipeScopeLabel(recipe, filters.projects, {
      global: "global",
      projectFallback: "project",
    });
    const matchesSearch =
      searchTerm.length === 0 ||
      [
        recipe.name,
        recipe.title,
        recipe.description,
        recipe.path,
        recipe.version,
        scopeLabel,
      ]
        .join(" ")
        .toLowerCase()
        .includes(searchTerm);

    const matchesFilter =
      filters.activeFilter === "global"
        ? recipe.scope === "global"
        : getRecipeProject(recipe, filters.projects)?.id ===
          filters.activeFilter.slice("project:".length);

    return matchesSearch && matchesFilter;
  });
}

export function compareRecipesByTitle(a: RecipeInfo, b: RecipeInfo): number {
  return (
    a.title.localeCompare(b.title, undefined, { sensitivity: "base" }) ||
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) ||
    a.path.localeCompare(b.path)
  );
}
