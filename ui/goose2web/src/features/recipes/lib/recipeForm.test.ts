import { describe, expect, it } from "vitest";
import {
  DEFAULT_RECIPE_FORM,
  recipeExtensionFromExtensionEntry,
  updateRecipeContent,
  type RecipeFormValues,
} from "./recipeForm";

function values(overrides: Partial<RecipeFormValues>): RecipeFormValues {
  return {
    ...DEFAULT_RECIPE_FORM,
    ...overrides,
  };
}

describe("recipeForm", () => {
  it("updates YAML template fields without dropping unknown content", () => {
    const content =
      'version: "1.0.0"\ntitle: "Old"\ndescription: "Old description"\nprompt: |\n  Old prompt\nextensions:\n  - type: builtin\n    name: developer\n';

    const updated = updateRecipeContent(
      content,
      values({
        title: "New",
        description: "New description",
        prompt: "Use {{ topic }}",
      }),
      "yaml",
    );

    expect(updated).toContain('title: "New"');
    expect(updated).toContain('description: "New description"');
    expect(updated).toContain("prompt: |\n  Use {{ topic }}");
    expect(updated).toContain(
      "extensions:\n  - type: builtin\n    name: developer",
    );
  });

  it("updates JSON template fields without dropping unknown content", () => {
    const content = JSON.stringify(
      {
        title: "Old",
        description: "Old description",
        prompt: "Old prompt",
        custom: { keep: true },
      },
      null,
      2,
    );

    const updated = updateRecipeContent(
      content,
      values({
        title: "New",
        description: "New description",
        prompt: "Use {{ topic }}",
      }),
      "json",
    );

    expect(JSON.parse(updated)).toMatchObject({
      title: "New",
      description: "New description",
      prompt: "Use {{ topic }}",
      custom: { keep: true },
    });
  });

  it("creates recipe extension form values from configured extensions", () => {
    const extension = recipeExtensionFromExtensionEntry({
      type: "streamable_http",
      name: "context7",
      description: "Docs",
      uri: "https://mcp.context7.com/mcp",
      env_keys: ["CONTEXT7_API_KEY"],
      headers: { "x-client": "goose" },
      timeout: 120,
      available_tools: ["resolve-library-id"],
      config_key: "context7",
      enabled: true,
    });

    expect(extension).toMatchObject({
      type: "streamable_http",
      name: "context7",
      uri: "https://mcp.context7.com/mcp",
      envKeys: "CONTEXT7_API_KEY",
      headers: '{\n  "x-client": "goose"\n}',
      timeout: "120",
      availableTools: "resolve-library-id",
    });
  });
});
