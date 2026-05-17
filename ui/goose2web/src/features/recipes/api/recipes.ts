import type { SourceEntry } from "@aaif/goose-sdk";
import { getClient } from "@/shared/api/acpConnection";

const RECIPE_SOURCE_TYPE = "recipe" as const;

export type RecipeScope = "global" | "project";

export interface RecipeInfo {
  id: string;
  name: string;
  title: string;
  description: string;
  content: string;
  path: string;
  scope: RecipeScope;
  format: "yaml" | "json";
  version: string;
}

type RecipeSourceEntry = SourceEntry & {
  type: typeof RECIPE_SOURCE_TYPE;
};

function isRecipeSource(source: SourceEntry): source is RecipeSourceEntry {
  return source.type === RECIPE_SOURCE_TYPE;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function toRecipeInfo(source: RecipeSourceEntry): RecipeInfo {
  const properties = source.properties ?? {};
  const format = stringValue(properties.format) === "json" ? "json" : "yaml";

  return {
    id: source.path,
    name: source.name,
    title: stringValue(properties.title) || source.name,
    description: source.description,
    content: source.content,
    path: source.path,
    scope: source.global ? "global" : "project",
    format,
    version: stringValue(properties.version),
  };
}

function uniqueProjectDirs(projectDirs: string[]) {
  return [...new Set(projectDirs.map((dir) => dir.trim()).filter(Boolean))];
}

export async function listRecipes(
  projectDirs: string[] = [],
): Promise<RecipeInfo[]> {
  const client = await getClient();
  const fetchRecipes = (projectDir?: string) =>
    client.goose.GooseSourcesList({
      type: RECIPE_SOURCE_TYPE,
      ...(projectDir ? { projectDir } : {}),
    });

  const globalResponse = await fetchRecipes();
  const projectResponses = await Promise.allSettled(
    uniqueProjectDirs(projectDirs).map((projectDir) =>
      fetchRecipes(projectDir),
    ),
  );
  const responses = [
    { response: globalResponse, projectResponse: false },
    ...projectResponses.flatMap((result) =>
      result.status === "fulfilled"
        ? [{ response: result.value, projectResponse: true }]
        : [],
    ),
  ];
  const seen = new Set<string>();

  return responses.flatMap(({ response, projectResponse }) =>
    response.sources.flatMap((source) => {
      if (
        !isRecipeSource(source) ||
        (projectResponse && source.global) ||
        seen.has(source.path)
      ) {
        return [];
      }
      seen.add(source.path);
      return [toRecipeInfo(source)];
    }),
  );
}

export async function createRecipe(input: {
  name: string;
  content: string;
  global: boolean;
  projectDir?: string;
}): Promise<RecipeInfo> {
  const client = await getClient();
  const response = await client.goose.GooseSourcesCreate({
    type: RECIPE_SOURCE_TYPE,
    name: input.name,
    description: "",
    content: input.content,
    global: input.global,
    ...(input.projectDir ? { projectDir: input.projectDir } : {}),
  });

  if (!isRecipeSource(response.source)) {
    throw new Error(`Unexpected source type returned: ${response.source.type}`);
  }

  return toRecipeInfo(response.source);
}

export async function updateRecipe(input: {
  path: string;
  name: string;
  content: string;
}): Promise<RecipeInfo> {
  const client = await getClient();
  const response = await client.goose.GooseSourcesUpdate({
    type: RECIPE_SOURCE_TYPE,
    path: input.path,
    name: input.name,
    description: "",
    content: input.content,
  });

  if (!isRecipeSource(response.source)) {
    throw new Error(`Unexpected source type returned: ${response.source.type}`);
  }

  return toRecipeInfo(response.source);
}

export async function deleteRecipe(path: string): Promise<void> {
  const client = await getClient();
  await client.goose.GooseSourcesDelete({
    type: RECIPE_SOURCE_TYPE,
    path,
  });
}

export async function exportRecipe(
  path: string,
): Promise<{ json: string; filename: string }> {
  const client = await getClient();
  const response = await client.goose.GooseSourcesExport({
    type: RECIPE_SOURCE_TYPE,
    path,
  });
  return { json: response.json, filename: response.filename };
}

export async function importRecipe(input: {
  fileBytes: number[];
  global: boolean;
  projectDir?: string;
}): Promise<RecipeInfo[]> {
  const data = new TextDecoder().decode(new Uint8Array(input.fileBytes));
  const client = await getClient();
  const response = await client.goose.GooseSourcesImport({
    data,
    global: input.global,
    ...(input.projectDir ? { projectDir: input.projectDir } : {}),
  });

  return response.sources.filter(isRecipeSource).map(toRecipeInfo);
}
