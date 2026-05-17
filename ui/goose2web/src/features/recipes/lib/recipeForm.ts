import type { RecipeInfo, RecipeScope } from "../api/recipes";
import type { ExtensionEntry } from "@/features/extensions/types";

export interface RecipeParameterFormValues {
  formId: string;
  key: string;
  inputType: string;
  requirement: string;
  description: string;
  defaultValue: string;
  options: string;
}

export interface RecipeSubRecipeFormValues {
  formId: string;
  name: string;
  path: string;
  values: string;
  sequentialWhenRepeated: boolean;
  description: string;
}

export interface RecipeRetryCheckFormValues {
  formId: string;
  command: string;
}

export interface RecipeExtensionFormValues {
  formId: string;
  type: string;
  name: string;
  description: string;
  displayName: string;
  cmd: string;
  args: string;
  envs: string;
  envKeys: string;
  uri: string;
  headers: string;
  socket: string;
  timeout: string;
  bundled: boolean;
  availableTools: string;
  tools: string;
  instructions: string;
  code: string;
  dependencies: string;
}

let formIdCounter = 0;

export function createRecipeFormId(): string {
  formIdCounter += 1;
  return `recipe-form-${formIdCounter}`;
}

export interface RecipeFormValues {
  name: string;
  title: string;
  description: string;
  version: string;
  instructions: string;
  prompt: string;
  provider: string;
  model: string;
  temperature: string;
  maxTurns: string;
  activities: string;
  authorContact: string;
  authorMetadata: string;
  responseJsonSchema: string;
  parameters: RecipeParameterFormValues[];
  subRecipes: RecipeSubRecipeFormValues[];
  retryMaxRetries: string;
  retryChecks: RecipeRetryCheckFormValues[];
  retryOnFailure: string;
  retryTimeoutSeconds: string;
  retryOnFailureTimeoutSeconds: string;
  extensions: RecipeExtensionFormValues[];
  scope: RecipeScope;
  projectId: string;
}

export const DEFAULT_RECIPE_FORM: RecipeFormValues = {
  name: "new-recipe",
  title: "New Recipe",
  description: "",
  version: "1.0.0",
  instructions: "",
  prompt: "",
  provider: "",
  model: "",
  temperature: "",
  maxTurns: "",
  activities: "",
  authorContact: "",
  authorMetadata: "",
  responseJsonSchema: "",
  parameters: [],
  subRecipes: [],
  retryMaxRetries: "",
  retryChecks: [],
  retryOnFailure: "",
  retryTimeoutSeconds: "",
  retryOnFailureTimeoutSeconds: "",
  extensions: [],
  scope: "global",
  projectId: "",
};

type ParsedRecipeContent = {
  title?: unknown;
  description?: unknown;
  version?: unknown;
  instructions?: unknown;
  prompt?: unknown;
  settings?: {
    goose_provider?: unknown;
    goose_model?: unknown;
    temperature?: unknown;
    max_turns?: unknown;
  };
  activities?: unknown;
  author?: {
    contact?: unknown;
    metadata?: unknown;
  };
  parameters?: unknown;
  response?: {
    json_schema?: unknown;
  };
  sub_recipes?: unknown;
  retry?: {
    max_retries?: unknown;
    checks?: unknown;
    on_failure?: unknown;
    timeout_seconds?: unknown;
    on_failure_timeout_seconds?: unknown;
  };
  extensions?: unknown;
};

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function scalarValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

function unquoteYamlScalar(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function readYamlScalar(content: string, key: string): string {
  const match = content.match(
    new RegExp(`^${key}:\\s*(?![|>])(.+?)\\s*$`, "m"),
  );
  return match ? unquoteYamlScalar(match[1]) : "";
}

function readYamlBlock(content: string, key: string): string {
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex((line) =>
    new RegExp(`^${key}:\\s*[|>]`).test(line),
  );
  if (start < 0) return readYamlScalar(content, key);

  const block: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim().length > 0 && !line.startsWith(" ")) {
      break;
    }
    block.push(line.startsWith("  ") ? line.slice(2) : line);
  }
  return block.join("\n").replace(/\n+$/, "");
}

function readYamlNestedScalar(
  content: string,
  parentKey: string,
  key: string,
): string {
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `${parentKey}:`);
  if (start < 0) return "";

  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim().length > 0 && !line.startsWith(" ")) {
      break;
    }
    const match = line.match(new RegExp(`^\\s+${key}:\\s*(.+?)\\s*$`));
    if (match) return unquoteYamlScalar(match[1]);
  }
  return "";
}

function readYamlInlineJson(content: string, key: string): unknown {
  const match = content.match(new RegExp(`^${key}:\\s*(.+?)\\s*$`, "m"));
  if (!match) return undefined;
  const value = match[1].trim();
  if (!value.startsWith("[") && !value.startsWith("{")) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function hasYamlTopLevel(content: string, key: string): boolean {
  return new RegExp(`^${key}:($|\\s)`, "m").test(content);
}

function stringArrayText(value: unknown): string {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === "string").join("\n")
    : "";
}

function jsonText(value: unknown): string {
  return value === undefined || value === null
    ? ""
    : JSON.stringify(value, null, 2);
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function parseJsonValue(value: string): unknown | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function listFromText(value: string): string[] {
  return value
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function boolValue(value: unknown): boolean {
  return typeof value === "boolean" ? value : false;
}

function formParameters(value: unknown): RecipeParameterFormValues[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const record = item as Record<string, unknown>;
      return {
        formId: createRecipeFormId(),
        key: stringValue(record.key),
        inputType: stringValue(record.input_type) || "string",
        requirement: stringValue(record.requirement) || "required",
        description: stringValue(record.description),
        defaultValue: scalarValue(record.default),
        options: stringArrayText(record.options),
      };
    });
}

function formSubRecipes(value: unknown): RecipeSubRecipeFormValues[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const record = item as Record<string, unknown>;
      return {
        formId: createRecipeFormId(),
        name: stringValue(record.name),
        path: stringValue(record.path),
        values: jsonText(record.values),
        sequentialWhenRepeated: boolValue(record.sequential_when_repeated),
        description: stringValue(record.description),
      };
    });
}

function formRetryChecks(value: unknown): RecipeRetryCheckFormValues[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      formId: createRecipeFormId(),
      command: stringValue((item as Record<string, unknown>).command),
    }));
}

function formExtensions(value: unknown): RecipeExtensionFormValues[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const record = item as Record<string, unknown>;
      return {
        formId: createRecipeFormId(),
        type: stringValue(record.type) || "builtin",
        name: stringValue(record.name),
        description: stringValue(record.description),
        displayName: stringValue(record.display_name),
        cmd: stringValue(record.cmd),
        args: stringArrayText(record.args),
        envs: jsonText(record.envs),
        envKeys: stringArrayText(record.env_keys),
        uri: stringValue(record.uri),
        headers: jsonText(record.headers),
        socket: stringValue(record.socket),
        timeout: scalarValue(record.timeout),
        bundled: boolValue(record.bundled),
        availableTools: stringArrayText(record.available_tools),
        tools: jsonText(record.tools),
        instructions: stringValue(record.instructions),
        code: stringValue(record.code),
        dependencies: stringArrayText(record.dependencies),
      };
    });
}

export function recipeExtensionFromExtensionEntry(
  extension: ExtensionEntry,
  options: { formId?: string; availableTools?: string } = {},
): RecipeExtensionFormValues {
  const extensionAvailableTools =
    "available_tools" in extension ? extension.available_tools : undefined;
  const extensionBundled =
    "bundled" in extension ? extension.bundled : undefined;
  const availableTools =
    options.availableTools ?? stringArrayText(extensionAvailableTools);
  const base = {
    formId: options.formId ?? createRecipeFormId(),
    type: extension.type,
    name: extension.name,
    description: extension.description ?? "",
    displayName: "",
    cmd: "",
    args: "",
    envs: "",
    envKeys: "",
    uri: "",
    headers: "",
    socket: "",
    timeout: "",
    bundled: extensionBundled ?? false,
    availableTools,
    tools: "",
    instructions: "",
    code: "",
    dependencies: "",
  };

  switch (extension.type) {
    case "stdio":
      return {
        ...base,
        cmd: extension.cmd,
        args: stringArrayText(extension.args),
        envs: jsonText(extension.envs),
        envKeys: stringArrayText(extension.env_keys),
        timeout: scalarValue(extension.timeout),
      };
    case "builtin":
      return {
        ...base,
        displayName: stringValue(extension.display_name),
        timeout: scalarValue(extension.timeout),
      };
    case "platform":
      return {
        ...base,
        displayName: stringValue(extension.display_name),
      };
    case "streamable_http":
      return {
        ...base,
        uri: extension.uri,
        envs: jsonText(extension.envs),
        envKeys: stringArrayText(extension.env_keys),
        headers: jsonText(extension.headers),
        socket: stringValue(extension.socket),
        timeout: scalarValue(extension.timeout),
      };
    case "frontend":
      return {
        ...base,
        tools: jsonText(extension.tools),
        instructions: stringValue(extension.instructions),
      };
    case "inline_python":
      return {
        ...base,
        code: extension.code,
        timeout: scalarValue(extension.timeout),
        dependencies: stringArrayText(extension.dependencies),
      };
    case "sse":
      return {
        ...base,
        uri: stringValue(extension.uri),
      };
  }
}

function parseRecipeContent(recipe: RecipeInfo): ParsedRecipeContent {
  const trimmed = recipe.content.trim();
  if (recipe.format === "json" || trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      const recipeNode = parsed.recipe ?? parsed;
      return recipeNode && typeof recipeNode === "object" ? recipeNode : {};
    } catch {
      return {};
    }
  }

  return {
    title: readYamlScalar(recipe.content, "title"),
    description: readYamlScalar(recipe.content, "description"),
    version: readYamlScalar(recipe.content, "version"),
    instructions: readYamlBlock(recipe.content, "instructions"),
    prompt: readYamlBlock(recipe.content, "prompt"),
    activities: readYamlInlineJson(recipe.content, "activities"),
    author: readYamlInlineJson(
      recipe.content,
      "author",
    ) as ParsedRecipeContent["author"],
    parameters: readYamlInlineJson(recipe.content, "parameters"),
    response: readYamlInlineJson(
      recipe.content,
      "response",
    ) as ParsedRecipeContent["response"],
    sub_recipes: readYamlInlineJson(recipe.content, "sub_recipes"),
    retry: readYamlInlineJson(
      recipe.content,
      "retry",
    ) as ParsedRecipeContent["retry"],
    extensions: readYamlInlineJson(recipe.content, "extensions"),
    settings: {
      goose_provider: readYamlNestedScalar(
        recipe.content,
        "settings",
        "goose_provider",
      ),
      goose_model: readYamlNestedScalar(
        recipe.content,
        "settings",
        "goose_model",
      ),
      temperature: readYamlNestedScalar(
        recipe.content,
        "settings",
        "temperature",
      ),
      max_turns: readYamlNestedScalar(recipe.content, "settings", "max_turns"),
    },
  };
}

export function formValuesFromRecipe(recipe: RecipeInfo): RecipeFormValues {
  const parsed = parseRecipeContent(recipe);
  const settings = parsed.settings ?? {};
  const retry = parsed.retry ?? {};
  return {
    ...DEFAULT_RECIPE_FORM,
    name: recipe.name,
    title: stringValue(parsed.title) || recipe.title,
    description: stringValue(parsed.description) || recipe.description,
    version: scalarValue(parsed.version) || recipe.version || "1.0.0",
    instructions: stringValue(parsed.instructions),
    prompt: stringValue(parsed.prompt),
    provider: stringValue(settings.goose_provider),
    model: stringValue(settings.goose_model),
    temperature: scalarValue(settings.temperature),
    maxTurns: scalarValue(settings.max_turns),
    activities: stringArrayText(parsed.activities),
    authorContact: stringValue(parsed.author?.contact),
    authorMetadata: stringValue(parsed.author?.metadata),
    responseJsonSchema: jsonText(parsed.response?.json_schema),
    parameters: formParameters(parsed.parameters),
    subRecipes: formSubRecipes(parsed.sub_recipes),
    retryMaxRetries: scalarValue(retry.max_retries),
    retryChecks: formRetryChecks(retry.checks),
    retryOnFailure: stringValue(retry.on_failure),
    retryTimeoutSeconds: scalarValue(retry.timeout_seconds),
    retryOnFailureTimeoutSeconds: scalarValue(retry.on_failure_timeout_seconds),
    extensions: formExtensions(parsed.extensions),
    scope: recipe.scope,
  };
}

export function formatRecipeName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/g, "")
    .slice(0, 64);
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function yamlBlock(key: string, value: string): string[] {
  const lines = value.trimEnd().split(/\r?\n/);
  return [`${key}: |`, ...lines.map((line) => `  ${line}`)];
}

function yamlFieldLines(key: string, value: string): string[] | null {
  return value.trim() ? yamlBlock(key, value) : null;
}

function recipeObject(values: RecipeFormValues) {
  const settings: Record<string, string | number> = {};
  if (values.provider.trim()) {
    settings.goose_provider = values.provider.trim();
  }
  if (values.model.trim()) {
    settings.goose_model = values.model.trim();
  }
  if (values.temperature.trim()) {
    settings.temperature = Number(values.temperature.trim());
  }
  if (values.maxTurns.trim()) {
    settings.max_turns = Number.parseInt(values.maxTurns.trim(), 10);
  }

  const author: Record<string, string> = {};
  if (values.authorContact.trim()) author.contact = values.authorContact.trim();
  if (values.authorMetadata.trim())
    author.metadata = values.authorMetadata.trim();

  const parameters = values.parameters
    .map((parameter) => {
      const next: Record<string, unknown> = {
        key: parameter.key.trim(),
        input_type: parameter.inputType,
        requirement: parameter.requirement,
        description: parameter.description.trim(),
      };
      if (parameter.defaultValue.trim())
        next.default = parameter.defaultValue.trim();
      const options = listFromText(parameter.options);
      if (options.length > 0) next.options = options;
      return next;
    })
    .filter((parameter) => parameter.key && parameter.description);

  const subRecipes = values.subRecipes
    .map((subRecipe) => {
      const next: Record<string, unknown> = {
        name: subRecipe.name.trim(),
        path: subRecipe.path.trim(),
        sequential_when_repeated: subRecipe.sequentialWhenRepeated,
      };
      const parsedValues = parseJsonObject(subRecipe.values);
      if (parsedValues) next.values = parsedValues;
      if (subRecipe.description.trim())
        next.description = subRecipe.description.trim();
      return next;
    })
    .filter((subRecipe) => subRecipe.name && subRecipe.path);

  const retryChecks = values.retryChecks
    .map((check) => check.command.trim())
    .filter(Boolean)
    .map((command) => ({ type: "shell", command }));
  const retry: Record<string, unknown> = {};
  if (values.retryMaxRetries.trim()) {
    retry.max_retries = Number.parseInt(values.retryMaxRetries.trim(), 10);
  }
  if (retryChecks.length > 0) retry.checks = retryChecks;
  if (values.retryOnFailure.trim())
    retry.on_failure = values.retryOnFailure.trim();
  if (values.retryTimeoutSeconds.trim()) {
    retry.timeout_seconds = Number.parseInt(
      values.retryTimeoutSeconds.trim(),
      10,
    );
  }
  if (values.retryOnFailureTimeoutSeconds.trim()) {
    retry.on_failure_timeout_seconds = Number.parseInt(
      values.retryOnFailureTimeoutSeconds.trim(),
      10,
    );
  }

  const extensions = values.extensions
    .map((extension) => {
      const next: Record<string, unknown> = {
        type: extension.type,
        name: extension.name.trim(),
      };
      if (extension.description.trim())
        next.description = extension.description.trim();
      if (extension.displayName.trim())
        next.display_name = extension.displayName.trim();
      if (extension.cmd.trim()) next.cmd = extension.cmd.trim();
      const args = listFromText(extension.args);
      if (args.length > 0) next.args = args;
      const envs = parseJsonObject(extension.envs);
      if (envs) next.envs = envs;
      const envKeys = listFromText(extension.envKeys);
      if (envKeys.length > 0) next.env_keys = envKeys;
      if (extension.uri.trim()) next.uri = extension.uri.trim();
      const headers = parseJsonObject(extension.headers);
      if (headers) next.headers = headers;
      if (extension.socket.trim()) next.socket = extension.socket.trim();
      if (extension.timeout.trim())
        next.timeout = Number.parseInt(extension.timeout.trim(), 10);
      if (extension.bundled) next.bundled = true;
      const availableTools = listFromText(extension.availableTools);
      if (availableTools.length > 0) next.available_tools = availableTools;
      const tools = parseJsonValue(extension.tools);
      if (tools) next.tools = tools;
      if (extension.instructions.trim())
        next.instructions = extension.instructions.trim();
      if (extension.code.trim()) next.code = extension.code.trim();
      const dependencies = listFromText(extension.dependencies);
      if (dependencies.length > 0) next.dependencies = dependencies;
      return next;
    })
    .filter((extension) => extension.name);

  const responseJsonSchema = parseJsonObject(values.responseJsonSchema);

  return {
    version: values.version.trim() || "1.0.0",
    title: values.title.trim(),
    description: values.description.trim(),
    ...(values.instructions.trim()
      ? { instructions: values.instructions.trimEnd() }
      : {}),
    ...(values.prompt.trim() ? { prompt: values.prompt.trimEnd() } : {}),
    ...(extensions.length ? { extensions } : {}),
    ...(Object.keys(settings).length ? { settings } : {}),
    ...(values.activities.trim()
      ? { activities: listFromText(values.activities) }
      : {}),
    ...(Object.keys(author).length ? { author } : {}),
    ...(parameters.length ? { parameters } : {}),
    ...(responseJsonSchema
      ? { response: { json_schema: responseJsonSchema } }
      : {}),
    ...(subRecipes.length ? { sub_recipes: subRecipes } : {}),
    ...(Object.keys(retry).length ? { retry } : {}),
  };
}

function replaceYamlTopLevel(
  content: string,
  key: string,
  replacement: string[] | null,
): string {
  const lines = content.replace(/\n?$/, "").split(/\r?\n/);
  const start = lines.findIndex((line) =>
    new RegExp(`^${key}:($|\\s)`).test(line),
  );

  if (start < 0) {
    return replacement ? `${lines.concat(replacement).join("\n")}\n` : content;
  }

  let end = start + 1;
  while (
    end < lines.length &&
    (lines[end].startsWith(" ") || lines[end].trim().length === 0)
  ) {
    end += 1;
  }

  lines.splice(start, end - start, ...(replacement ?? []));
  return `${lines.join("\n").replace(/\n+$/, "")}\n`;
}

function settingValue(value: string, numeric: boolean): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return numeric ? trimmed : yamlString(trimmed);
}

function updateYamlSetting(
  content: string,
  key: string,
  value: string | null,
): string {
  const lines = content.replace(/\n?$/, "").split(/\r?\n/);
  const settingsStart = lines.findIndex((line) => line.trim() === "settings:");

  if (settingsStart < 0) {
    if (!value) return content;
    lines.push("settings:", `  ${key}: ${value}`);
    return `${lines.join("\n")}\n`;
  }

  let settingsEnd = settingsStart + 1;
  while (
    settingsEnd < lines.length &&
    (lines[settingsEnd].startsWith(" ") ||
      lines[settingsEnd].trim().length === 0)
  ) {
    settingsEnd += 1;
  }

  const settingIndex = lines.findIndex(
    (line, index) =>
      index > settingsStart &&
      index < settingsEnd &&
      new RegExp(`^\\s+${key}:\\s*`).test(line),
  );

  if (settingIndex >= 0) {
    if (value) {
      lines[settingIndex] = `  ${key}: ${value}`;
    } else {
      lines.splice(settingIndex, 1);
      settingsEnd -= 1;
    }
  } else if (value) {
    lines.splice(settingsStart + 1, 0, `  ${key}: ${value}`);
    settingsEnd += 1;
  }

  const hasSettingsBody = lines
    .slice(settingsStart + 1, settingsEnd)
    .some((line) => line.trim().length > 0);
  if (!hasSettingsBody) {
    lines.splice(settingsStart, settingsEnd - settingsStart);
  }

  return `${lines.join("\n").replace(/\n+$/, "")}\n`;
}

function updateYamlContent(content: string, values: RecipeFormValues): string {
  let next = content.trim() ? content : buildRecipeContent(values);
  next = replaceYamlTopLevel(next, "version", [
    `version: ${yamlString(values.version.trim() || "1.0.0")}`,
  ]);
  next = replaceYamlTopLevel(next, "title", [
    `title: ${yamlString(values.title.trim())}`,
  ]);
  next = replaceYamlTopLevel(next, "description", [
    `description: ${yamlString(values.description.trim())}`,
  ]);
  next = replaceYamlTopLevel(
    next,
    "instructions",
    yamlFieldLines("instructions", values.instructions),
  );
  next = replaceYamlTopLevel(
    next,
    "prompt",
    yamlFieldLines("prompt", values.prompt),
  );
  next = updateYamlSetting(
    next,
    "goose_provider",
    settingValue(values.provider, false),
  );
  next = updateYamlSetting(
    next,
    "goose_model",
    settingValue(values.model, false),
  );
  next = updateYamlSetting(
    next,
    "temperature",
    settingValue(values.temperature, true),
  );
  next = updateYamlSetting(
    next,
    "max_turns",
    settingValue(values.maxTurns, true),
  );
  const recipe = recipeObject(values);
  if (
    recipe.activities ||
    values.activities.trim() ||
    !hasYamlTopLevel(next, "activities")
  ) {
    next = replaceYamlTopLevel(
      next,
      "activities",
      recipe.activities
        ? [`activities: ${JSON.stringify(recipe.activities)}`]
        : null,
    );
  }
  if (
    recipe.author ||
    values.authorContact.trim() ||
    values.authorMetadata.trim() ||
    !hasYamlTopLevel(next, "author")
  ) {
    next = replaceYamlTopLevel(
      next,
      "author",
      recipe.author ? [`author: ${JSON.stringify(recipe.author)}`] : null,
    );
  }
  if (
    recipe.parameters ||
    values.parameters.length > 0 ||
    !hasYamlTopLevel(next, "parameters")
  ) {
    next = replaceYamlTopLevel(
      next,
      "parameters",
      recipe.parameters
        ? [`parameters: ${JSON.stringify(recipe.parameters)}`]
        : null,
    );
  }
  if (
    recipe.response ||
    values.responseJsonSchema.trim() ||
    !hasYamlTopLevel(next, "response")
  ) {
    next = replaceYamlTopLevel(
      next,
      "response",
      recipe.response ? [`response: ${JSON.stringify(recipe.response)}`] : null,
    );
  }
  if (
    recipe.sub_recipes ||
    values.subRecipes.length > 0 ||
    !hasYamlTopLevel(next, "sub_recipes")
  ) {
    next = replaceYamlTopLevel(
      next,
      "sub_recipes",
      recipe.sub_recipes
        ? [`sub_recipes: ${JSON.stringify(recipe.sub_recipes)}`]
        : null,
    );
  }
  if (
    recipe.retry ||
    values.retryMaxRetries.trim() ||
    values.retryChecks.length > 0 ||
    values.retryOnFailure.trim() ||
    values.retryTimeoutSeconds.trim() ||
    values.retryOnFailureTimeoutSeconds.trim() ||
    !hasYamlTopLevel(next, "retry")
  ) {
    next = replaceYamlTopLevel(
      next,
      "retry",
      recipe.retry ? [`retry: ${JSON.stringify(recipe.retry)}`] : null,
    );
  }
  if (
    recipe.extensions ||
    values.extensions.length > 0 ||
    !hasYamlTopLevel(next, "extensions")
  ) {
    next = replaceYamlTopLevel(
      next,
      "extensions",
      recipe.extensions
        ? [`extensions: ${JSON.stringify(recipe.extensions)}`]
        : null,
    );
  }
  return next;
}

function updateJsonContent(content: string, values: RecipeFormValues): string {
  try {
    const parsed = content.trim() ? JSON.parse(content) : {};
    const target =
      parsed.recipe && typeof parsed.recipe === "object"
        ? parsed.recipe
        : parsed;
    const recipe = recipeObject(values);

    target.version = recipe.version;
    target.title = recipe.title;
    target.description = recipe.description;

    if (recipe.instructions) {
      target.instructions = recipe.instructions;
    } else {
      delete target.instructions;
    }
    if (recipe.prompt) {
      target.prompt = recipe.prompt;
    } else {
      delete target.prompt;
    }

    const existingSettings =
      target.settings && typeof target.settings === "object"
        ? target.settings
        : {};
    for (const key of [
      "goose_provider",
      "goose_model",
      "temperature",
      "max_turns",
    ]) {
      delete existingSettings[key];
    }
    if (recipe.settings) {
      Object.assign(existingSettings, recipe.settings);
    }
    if (Object.keys(existingSettings).length > 0) {
      target.settings = existingSettings;
    } else {
      delete target.settings;
    }
    for (const key of [
      "activities",
      "author",
      "parameters",
      "response",
      "sub_recipes",
      "retry",
      "extensions",
    ]) {
      delete target[key];
    }
    Object.assign(target, {
      ...(recipe.activities ? { activities: recipe.activities } : {}),
      ...(recipe.author ? { author: recipe.author } : {}),
      ...(recipe.parameters ? { parameters: recipe.parameters } : {}),
      ...(recipe.response ? { response: recipe.response } : {}),
      ...(recipe.sub_recipes ? { sub_recipes: recipe.sub_recipes } : {}),
      ...(recipe.retry ? { retry: recipe.retry } : {}),
      ...(recipe.extensions ? { extensions: recipe.extensions } : {}),
    });

    return `${JSON.stringify(parsed, null, 2)}\n`;
  } catch {
    return buildRecipeContent(values, "json");
  }
}

export function updateRecipeContent(
  content: string,
  values: RecipeFormValues,
  format: "yaml" | "json" = "yaml",
): string {
  return format === "json"
    ? updateJsonContent(content, values)
    : updateYamlContent(content, values);
}

export function buildRecipeContent(
  values: RecipeFormValues,
  format: "yaml" | "json" = "yaml",
): string {
  const recipe = recipeObject(values);
  if (format === "json") {
    return `${JSON.stringify(recipe, null, 2)}\n`;
  }

  const lines = [
    `version: ${yamlString(recipe.version)}`,
    `title: ${yamlString(recipe.title)}`,
    `description: ${yamlString(recipe.description)}`,
  ];

  if (recipe.instructions) {
    lines.push(...yamlBlock("instructions", recipe.instructions));
  }
  if (recipe.prompt) {
    lines.push(...yamlBlock("prompt", recipe.prompt));
  }
  if (recipe.settings) {
    lines.push("settings:");
    for (const [key, value] of Object.entries(recipe.settings)) {
      lines.push(
        `  ${key}: ${typeof value === "number" ? value : yamlString(value)}`,
      );
    }
  }
  for (const key of [
    "extensions",
    "activities",
    "author",
    "parameters",
    "response",
    "sub_recipes",
    "retry",
  ] as const) {
    if (recipe[key]) {
      lines.push(`${key}: ${JSON.stringify(recipe[key])}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

export function isValidRecipeForm(values: RecipeFormValues): boolean {
  return (
    values.name.trim().length > 0 &&
    values.title.trim().length > 0 &&
    values.description.trim().length > 0 &&
    (values.instructions.trim().length > 0 || values.prompt.trim().length > 0)
  );
}
