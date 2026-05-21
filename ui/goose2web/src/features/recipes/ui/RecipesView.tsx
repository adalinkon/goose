import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, Plus, Trash2, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { listExtensions } from "@/features/extensions/api/extensions";
import type { ExtensionEntry } from "@/features/extensions/types";
import { getDisplayName } from "@/features/extensions/types";
import { selectProjects } from "@/features/projects/stores/projectSelectors";
import { useProjectStore } from "@/features/projects/stores/projectStore";
import { cn } from "@/shared/lib/cn";
import { SettingsPage } from "@/shared/ui/SettingsPage";
import { Button } from "@/shared/ui/button";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { PageShell } from "@/shared/ui/page-shell";
import { SearchBar } from "@/shared/ui/SearchBar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { Skeleton } from "@/shared/ui/skeleton";
import { Textarea } from "@/shared/ui/textarea";
import {
  createRecipe,
  deleteRecipe,
  exportRecipe,
  importRecipe,
  listRecipes,
  updateRecipe,
  type RecipeInfo,
  type RecipeScope,
} from "../api/recipes";
import { downloadRecipeExport } from "../lib/recipeDownload";
import {
  buildRecipeContent,
  createRecipeFormId,
  DEFAULT_RECIPE_FORM,
  formatRecipeName,
  formValuesFromRecipe,
  isValidRecipeForm,
  recipeExtensionFromExtensionEntry,
  updateRecipeContent,
  type RecipeExtensionFormValues,
  type RecipeFormValues,
  type RecipeParameterFormValues,
  type RecipeRetryCheckFormValues,
  type RecipeSubRecipeFormValues,
} from "../lib/recipeForm";
import {
  compareRecipesByTitle,
  filterRecipes,
  recipeProjectOptions,
  type RecipeFilter,
} from "../lib/recipeProjects";
import { RecipesToolbar } from "./RecipesToolbar";

type EditorMode = "template" | "raw";

type DraftState = {
  id: string | null;
  path: string | null;
  format: "yaml" | "json";
  values: RecipeFormValues;
  rawContent: string;
  baselineContent: string;
  baselineName: string;
  mode: EditorMode;
};

const NO_PROJECT_VALUE = "__none__";

const PARAMETER_INPUT_TYPES = [
  "string",
  "number",
  "boolean",
  "date",
  "file",
  "select",
];
const PARAMETER_REQUIREMENTS = ["required", "optional", "user_prompt"];
const NO_EXTENSION_VALUE = "__none__";

function defaultParameter(): RecipeParameterFormValues {
  return {
    formId: createRecipeFormId(),
    key: "",
    inputType: "string",
    requirement: "required",
    description: "",
    defaultValue: "",
    options: "",
  };
}

function defaultSubRecipe(): RecipeSubRecipeFormValues {
  return {
    formId: createRecipeFormId(),
    name: "",
    path: "",
    values: "",
    sequentialWhenRepeated: false,
    description: "",
  };
}

function defaultRetryCheck(): RecipeRetryCheckFormValues {
  return { formId: createRecipeFormId(), command: "" };
}

function defaultExtension(): RecipeExtensionFormValues {
  return {
    formId: createRecipeFormId(),
    type: "builtin",
    name: "",
    description: "",
    displayName: "",
    cmd: "",
    args: "",
    envs: "",
    envKeys: "",
    uri: "",
    headers: "",
    socket: "",
    timeout: "",
    bundled: false,
    availableTools: "",
    tools: "",
    instructions: "",
    code: "",
    dependencies: "",
  };
}

function recipeExtensionSelectValue(extension: RecipeExtensionFormValues) {
  return extension.name
    ? `${extension.type}:${extension.name}`
    : NO_EXTENSION_VALUE;
}

function configuredExtensionSelectValue(extension: ExtensionEntry) {
  return `${extension.type}:${extension.name}`;
}

function isRecipeSelectableExtension(extension: ExtensionEntry) {
  return extension.type !== "sse";
}

function makeNewDraft(projectId = ""): DraftState {
  const values = {
    ...DEFAULT_RECIPE_FORM,
    projectId,
  };
  const rawContent = buildRecipeContent(values);
  return {
    id: null,
    path: null,
    format: "yaml",
    values,
    rawContent,
    baselineContent: "",
    baselineName: values.name,
    mode: "template",
  };
}

function makeRecipeDraft(recipe: RecipeInfo): DraftState {
  return {
    id: recipe.id,
    path: recipe.path,
    format: recipe.format,
    values: formValuesFromRecipe(recipe),
    rawContent: recipe.content,
    baselineContent: recipe.content,
    baselineName: recipe.name,
    mode: "raw",
  };
}

function RecipeListSkeleton() {
  return (
    <div className="space-y-2">
      {[1, 2, 3].map((item) => (
        <div
          key={item}
          aria-hidden="true"
          className="rounded-md border border-border p-2"
        >
          <Skeleton className="h-3 w-2/3" />
          <Skeleton className="mt-2 h-3 w-full" />
        </div>
      ))}
    </div>
  );
}

function isValidDraft(draft: DraftState): boolean {
  if (draft.mode === "raw") {
    return (
      draft.values.name.trim().length > 0 && draft.rawContent.trim().length > 0
    );
  }
  return isValidRecipeForm(draft.values);
}

function EditorSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3 border-t border-border pt-4">
      <h5 className="text-xs font-semibold uppercase text-muted-foreground">
        {title}
      </h5>
      {children}
    </section>
  );
}

function RemoveButton({ onClick }: { onClick: () => void }) {
  return (
    <Button type="button" size="xs" variant="ghost" onClick={onClick}>
      <Trash2 className="size-3.5" />
    </Button>
  );
}

export function RecipesView() {
  const { t } = useTranslation(["recipes", "common"]);
  const projects = useProjectStore(selectProjects);
  const projectOptions = useMemo(
    () => recipeProjectOptions(projects),
    [projects],
  );
  const projectDirs = useMemo(
    () => projectOptions.map((project) => project.workingDir),
    [projectOptions],
  );
  const [recipes, setRecipes] = useState<RecipeInfo[]>([]);
  const [configuredExtensions, setConfiguredExtensions] = useState<
    ExtensionEntry[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState<RecipeFilter>("global");
  const [draft, setDraft] = useState<DraftState>(() =>
    makeNewDraft(projectOptions[0]?.id ?? ""),
  );
  const [deletingRecipe, setDeletingRecipe] = useState<RecipeInfo | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const loadRequestIdRef = useRef(0);

  const loadRecipes = useCallback(async () => {
    const requestId = loadRequestIdRef.current + 1;
    loadRequestIdRef.current = requestId;
    setLoading(true);

    try {
      const result = await listRecipes(projectDirs);
      if (loadRequestIdRef.current !== requestId) return;
      setRecipes(result);
      setDraft((current) => {
        if (!current.id) return current;
        const nextRecipe = result.find((recipe) => recipe.id === current.id);
        return nextRecipe
          ? makeRecipeDraft(nextRecipe)
          : makeNewDraft(projectOptions[0]?.id ?? "");
      });
    } catch {
      if (loadRequestIdRef.current === requestId) {
        setRecipes([]);
        toast.error(t("view.loadError"));
      }
    } finally {
      if (loadRequestIdRef.current === requestId) {
        setLoading(false);
      }
    }
  }, [projectDirs, projectOptions, t]);

  useEffect(() => {
    void loadRecipes();
  }, [loadRecipes]);

  useEffect(() => {
    let cancelled = false;
    void listExtensions()
      .then((result) => {
        if (!cancelled) setConfiguredExtensions(result);
      })
      .catch(() => {
        if (!cancelled) setConfiguredExtensions([]);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (activeFilter === "global") return;
    const projectId = activeFilter.slice("project:".length);
    if (!projectOptions.some((project) => project.id === projectId)) {
      setActiveFilter("global");
    }
  }, [activeFilter, projectOptions]);

  const filteredRecipes = useMemo(
    () =>
      filterRecipes(recipes, {
        search,
        activeFilter,
        projects: projectOptions,
      }).sort(compareRecipesByTitle),
    [activeFilter, projectOptions, recipes, search],
  );
  const selectableExtensions = useMemo(
    () => configuredExtensions.filter(isRecipeSelectableExtension),
    [configuredExtensions],
  );

  const selectedRecipe = draft.id
    ? (recipes.find((recipe) => recipe.id === draft.id) ?? null)
    : null;
  const selectedProject = projectOptions.find(
    (project) => project.id === draft.values.projectId,
  );
  const canSaveProjectRecipe =
    draft.values.scope === "global" || Boolean(selectedProject);
  const canSave =
    !saving &&
    canSaveProjectRecipe &&
    isValidDraft(draft) &&
    (draft.id === null ||
      draft.rawContent !== draft.baselineContent ||
      draft.values.name !== draft.baselineName);

  const updateValues = <K extends keyof RecipeFormValues>(
    key: K,
    value: RecipeFormValues[K],
  ) => {
    setDraft((current) => {
      const values = { ...current.values, [key]: value };
      return {
        ...current,
        values,
        rawContent:
          current.mode === "template"
            ? updateRecipeContent(current.rawContent, values, current.format)
            : current.rawContent,
      };
    });
  };

  const updateListValue = <
    K extends "parameters" | "subRecipes" | "retryChecks" | "extensions",
  >(
    key: K,
    updater: (items: RecipeFormValues[K]) => RecipeFormValues[K],
  ) => {
    setDraft((current) => {
      const values = {
        ...current.values,
        [key]: updater(current.values[key]),
      };
      return {
        ...current,
        values,
        rawContent:
          current.mode === "template"
            ? updateRecipeContent(current.rawContent, values, current.format)
            : current.rawContent,
      };
    });
  };

  const addListItem = <
    K extends "parameters" | "subRecipes" | "retryChecks" | "extensions",
  >(
    key: K,
    item: RecipeFormValues[K][number],
  ) => {
    updateListValue(key, (items) => [...items, item] as RecipeFormValues[K]);
  };

  const removeListItem = <
    K extends "parameters" | "subRecipes" | "retryChecks" | "extensions",
  >(
    key: K,
    index: number,
  ) => {
    updateListValue(
      key,
      (items) =>
        items.filter(
          (_, itemIndex) => itemIndex !== index,
        ) as RecipeFormValues[K],
    );
  };

  const updateListItem = <
    K extends "parameters" | "subRecipes" | "retryChecks" | "extensions",
  >(
    key: K,
    index: number,
    nextItem: RecipeFormValues[K][number],
  ) => {
    updateListValue(
      key,
      (items) =>
        items.map((item, itemIndex) =>
          itemIndex === index ? nextItem : item,
        ) as RecipeFormValues[K],
    );
  };

  const handleSelectRecipeExtension = (
    index: number,
    extensionKey: string,
    current: RecipeExtensionFormValues,
  ) => {
    const selected = selectableExtensions.find(
      (extension) => configuredExtensionSelectValue(extension) === extensionKey,
    );
    if (!selected) return;

    updateListItem(
      "extensions",
      index,
      recipeExtensionFromExtensionEntry(selected, {
        formId: current.formId,
        availableTools: current.name ? current.availableTools : undefined,
      }),
    );
  };

  const handleAddRecipeExtension = () => {
    addListItem(
      "extensions",
      selectableExtensions[0]
        ? recipeExtensionFromExtensionEntry(selectableExtensions[0])
        : defaultExtension(),
    );
  };

  const setMode = (mode: EditorMode) => {
    setDraft((current) => {
      if (current.mode === mode) return current;
      if (mode === "template") {
        return {
          ...current,
          mode,
          values: formValuesFromRecipe({
            id: current.id ?? current.values.name,
            name: current.values.name,
            title: current.values.title,
            description: current.values.description,
            content: current.rawContent,
            path: current.path ?? "",
            scope: current.values.scope,
            format: current.format,
            version: current.values.version,
          }),
        };
      }
      return { ...current, mode };
    });
  };

  const handleNewRecipe = () => {
    const projectId =
      activeFilter === "global" ? "" : activeFilter.slice("project:".length);
    const nextDraft = makeNewDraft(projectId);
    setDraft({
      ...nextDraft,
      values: {
        ...nextDraft.values,
        scope: projectId ? "project" : "global",
      },
    });
  };

  const handleSelectRecipe = (recipe: RecipeInfo) => {
    setDraft(makeRecipeDraft(recipe));
  };

  const handleSaveRecipe = async () => {
    if (!canSave) return;
    const name = draft.values.name.trim();
    const content =
      draft.mode === "template"
        ? buildRecipeContent(draft.values, draft.format)
        : draft.rawContent;

    setSaving(true);
    try {
      const saved = draft.path
        ? await updateRecipe({
            path: draft.path,
            name,
            content,
          })
        : await createRecipe({
            name,
            content,
            global: draft.values.scope === "global",
            projectDir:
              draft.values.scope === "project"
                ? selectedProject?.workingDir
                : undefined,
          });
      await loadRecipes();
      setDraft(makeRecipeDraft(saved));
      toast.success(t("view.saveSuccess"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("view.saveError"));
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deletingRecipe) return;
    try {
      await deleteRecipe(deletingRecipe.path);
      setDraft((current) =>
        current.id === deletingRecipe.id
          ? makeNewDraft(projectOptions[0]?.id ?? "")
          : current,
      );
      await loadRecipes();
      toast.success(t("view.deleteSuccess"));
    } catch {
      toast.error(t("view.deleteError"));
    }
    setDeletingRecipe(null);
  };

  const handleExport = async () => {
    if (!selectedRecipe) return;
    try {
      const result = await exportRecipe(selectedRecipe.path);
      downloadRecipeExport(result.json, result.filename);
    } catch {
      toast.error(t("view.exportError"));
    }
  };

  const handleImportInputChange = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const targetProject =
      activeFilter === "global"
        ? null
        : projectOptions.find(
            (project) => `project:${project.id}` === activeFilter,
          );

    try {
      const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
      const imported = await importRecipe({
        fileBytes: bytes,
        global: activeFilter === "global",
        projectDir: targetProject?.workingDir,
      });
      await loadRecipes();
      if (imported[0]) {
        setDraft(makeRecipeDraft(imported[0]));
      }
      toast.success(t("view.importSuccess"));
    } catch {
      toast.error(t("view.importError"));
    } finally {
      setFileInputKey((current) => current + 1);
    }
  };

  const openFilePicker = () => {
    document.getElementById("recipe-import-input")?.click();
  };

  return (
    <PageShell contentClassName="gap-0">
      <SettingsPage
        title={t("view.title")}
        description={t("view.description")}
        actions={
          <>
            <input
              id="recipe-import-input"
              key={fileInputKey}
              type="file"
              accept=".recipe.json,.json"
              className="hidden"
              onChange={(event) => void handleImportInputChange(event)}
            />
            <Button
              type="button"
              variant="outline-flat"
              size="xs"
              onClick={openFilePicker}
            >
              <Upload className="size-3.5" />
              {t("common:actions.import")}
            </Button>
            <Button
              type="button"
              variant="outline-flat"
              size="xs"
              onClick={handleNewRecipe}
            >
              <Plus className="size-3.5" />
              {t("view.newRecipe")}
            </Button>
            {selectedRecipe ? (
              <>
                <Button
                  type="button"
                  variant="outline-flat"
                  size="xs"
                  onClick={() => void handleExport()}
                >
                  <Download className="size-3.5" />
                  {t("common:actions.export")}
                </Button>
                <Button
                  type="button"
                  variant="destructive-flat"
                  size="xs"
                  onClick={() => setDeletingRecipe(selectedRecipe)}
                >
                  <Trash2 className="size-3.5" />
                  {t("common:actions.delete")}
                </Button>
              </>
            ) : null}
            <Button
              type="button"
              size="xs"
              disabled={!canSave}
              onClick={() => void handleSaveRecipe()}
            >
              {saving ? t("common:actions.saving") : t("common:actions.save")}
            </Button>
          </>
        }
      >
        <div className="grid gap-3 md:grid-cols-[16rem_minmax(0,1fr)]">
          <div className="space-y-3">
            <SearchBar
              value={search}
              onChange={setSearch}
              placeholder={t("view.searchPlaceholder")}
              aria-label={t("view.searchPlaceholder")}
            />
            <RecipesToolbar
              activeFilter={activeFilter}
              onActiveFilterChange={setActiveFilter}
              projects={projectOptions}
            />
            <div className="rounded-lg border border-border p-2">
              {loading ? (
                <RecipeListSkeleton />
              ) : filteredRecipes.length === 0 ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={handleNewRecipe}
                  className="w-full justify-start rounded-md border border-dashed border-border px-2 py-2 text-xs text-muted-foreground"
                >
                  <Plus className="size-3.5" />
                  {t("view.newRecipe")}
                </Button>
              ) : (
                <div className="space-y-1">
                  {filteredRecipes.map((recipe) => {
                    const selected = recipe.id === draft.id;
                    return (
                      <button
                        type="button"
                        key={recipe.id}
                        onClick={() => handleSelectRecipe(recipe)}
                        className={cn(
                          "w-full rounded-md border px-2 py-1.5 text-left",
                          selected
                            ? "border-border bg-muted text-foreground"
                            : "border-transparent text-muted-foreground hover:border-border hover:bg-muted/40 hover:text-foreground",
                        )}
                      >
                        <span className="block truncate text-xs font-medium">
                          {recipe.name}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-border p-3">
            <div className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h4 className="truncate text-sm font-semibold">
                    {draft.values.title || t("view.unsaved")}
                  </h4>
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {draft.path ?? t("view.unsaved")}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    size="xs"
                    variant={
                      draft.mode === "template" ? "default" : "outline-flat"
                    }
                    onClick={() => setMode("template")}
                  >
                    {t("editor.templateMode")}
                  </Button>
                  <Button
                    type="button"
                    size="xs"
                    variant={draft.mode === "raw" ? "default" : "outline-flat"}
                    onClick={() => setMode("raw")}
                  >
                    {t("editor.rawMode")}
                  </Button>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label className="text-xs font-medium text-muted-foreground">
                    {t("editor.fileName")}{" "}
                    <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    value={draft.values.name}
                    onChange={(event) =>
                      updateValues("name", formatRecipeName(event.target.value))
                    }
                    aria-label={t("editor.fileName")}
                    required
                    placeholder={t("editor.fileNamePlaceholder")}
                  />
                </div>

                {!draft.path ? (
                  <div className="space-y-1">
                    <Label className="text-xs font-medium text-muted-foreground">
                      {t("editor.scope")}
                    </Label>
                    <Select
                      value={draft.values.scope}
                      onValueChange={(value: RecipeScope) =>
                        updateValues("scope", value)
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="global">
                          {t("view.filtersGlobal")}
                        </SelectItem>
                        <SelectItem
                          value="project"
                          disabled={projectOptions.length === 0}
                        >
                          {t("editor.projectScope")}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}

                {!draft.path && draft.values.scope === "project" ? (
                  <div className="space-y-1 sm:col-span-2">
                    <Label className="text-xs font-medium text-muted-foreground">
                      {t("editor.project")}
                    </Label>
                    <Select
                      value={draft.values.projectId || NO_PROJECT_VALUE}
                      onValueChange={(value) =>
                        updateValues(
                          "projectId",
                          value === NO_PROJECT_VALUE ? "" : value,
                        )
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NO_PROJECT_VALUE} disabled>
                          {t("editor.selectProject")}
                        </SelectItem>
                        {projectOptions.map((project) => (
                          <SelectItem key={project.id} value={project.id}>
                            {project.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}
              </div>

              {draft.mode === "raw" ? (
                <Textarea
                  value={draft.rawContent}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      rawContent: event.target.value,
                    }))
                  }
                  rows={22}
                  className="min-h-[440px] font-mono text-xs"
                  aria-label={t("editor.rawContentLabel")}
                />
              ) : (
                <div className="space-y-4">
                  <EditorSection title={t("editor.sections.core")}>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1">
                        <Label className="text-xs font-medium text-muted-foreground">
                          {t("editor.title")}{" "}
                          <span className="text-destructive">*</span>
                        </Label>
                        <Input
                          value={draft.values.title}
                          onChange={(event) =>
                            updateValues("title", event.target.value)
                          }
                          aria-label={t("editor.title")}
                          required
                          placeholder={t("editor.titlePlaceholder")}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs font-medium text-muted-foreground">
                          {t("editor.version")}
                        </Label>
                        <Input
                          value={draft.values.version}
                          onChange={(event) =>
                            updateValues("version", event.target.value)
                          }
                          aria-label={t("editor.version")}
                          placeholder="1.0.0"
                        />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <Label className="text-xs font-medium text-muted-foreground">
                        {t("editor.description")}{" "}
                        <span className="text-destructive">*</span>
                      </Label>
                      <Textarea
                        value={draft.values.description}
                        onChange={(event) =>
                          updateValues("description", event.target.value)
                        }
                        aria-label={t("editor.description")}
                        required
                        rows={3}
                        placeholder={t("editor.descriptionPlaceholder")}
                      />
                    </div>

                    <div className="space-y-1">
                      <Label className="text-xs font-medium text-muted-foreground">
                        {t("editor.instructions")}
                      </Label>
                      <Textarea
                        value={draft.values.instructions}
                        onChange={(event) =>
                          updateValues("instructions", event.target.value)
                        }
                        aria-label={t("editor.instructions")}
                        rows={6}
                        placeholder={t("editor.instructionsPlaceholder")}
                        className="leading-relaxed"
                      />
                    </div>

                    <div className="space-y-1">
                      <Label className="text-xs font-medium text-muted-foreground">
                        {t("editor.prompt")}
                      </Label>
                      <Textarea
                        value={draft.values.prompt}
                        onChange={(event) =>
                          updateValues("prompt", event.target.value)
                        }
                        aria-label={t("editor.prompt")}
                        rows={4}
                        placeholder={t("editor.promptPlaceholder")}
                        className="leading-relaxed"
                      />
                      <p
                        className={cn(
                          "text-[11px] text-muted-foreground",
                          !draft.values.instructions.trim() &&
                            !draft.values.prompt.trim() &&
                            "text-destructive",
                        )}
                      >
                        {t("editor.promptHelp")}
                      </p>
                    </div>
                  </EditorSection>

                  <EditorSection title={t("editor.sections.settings")}>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1">
                        <Label className="text-xs font-medium text-muted-foreground">
                          {t("editor.provider")}
                        </Label>
                        <Input
                          value={draft.values.provider}
                          onChange={(event) =>
                            updateValues("provider", event.target.value)
                          }
                          aria-label={t("editor.provider")}
                          placeholder={t("editor.providerPlaceholder")}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs font-medium text-muted-foreground">
                          {t("editor.model")}
                        </Label>
                        <Input
                          value={draft.values.model}
                          onChange={(event) =>
                            updateValues("model", event.target.value)
                          }
                          aria-label={t("editor.model")}
                          placeholder={t("editor.modelPlaceholder")}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs font-medium text-muted-foreground">
                          {t("editor.temperature")}
                        </Label>
                        <Input
                          value={draft.values.temperature}
                          onChange={(event) =>
                            updateValues("temperature", event.target.value)
                          }
                          aria-label={t("editor.temperature")}
                          inputMode="decimal"
                          placeholder="0.7"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs font-medium text-muted-foreground">
                          {t("editor.maxTurns")}
                        </Label>
                        <Input
                          value={draft.values.maxTurns}
                          onChange={(event) =>
                            updateValues("maxTurns", event.target.value)
                          }
                          aria-label={t("editor.maxTurns")}
                          inputMode="numeric"
                          placeholder="20"
                        />
                      </div>
                    </div>
                  </EditorSection>

                  <EditorSection title={t("editor.sections.activitiesAuthor")}>
                    <div className="space-y-1">
                      <Label className="text-xs font-medium text-muted-foreground">
                        {t("editor.activities")}
                      </Label>
                      <Textarea
                        value={draft.values.activities}
                        onChange={(event) =>
                          updateValues("activities", event.target.value)
                        }
                        aria-label={t("editor.activities")}
                        rows={3}
                        placeholder={t("editor.activitiesPlaceholder")}
                      />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1">
                        <Label className="text-xs font-medium text-muted-foreground">
                          {t("editor.authorContact")}
                        </Label>
                        <Input
                          value={draft.values.authorContact}
                          onChange={(event) =>
                            updateValues("authorContact", event.target.value)
                          }
                          aria-label={t("editor.authorContact")}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs font-medium text-muted-foreground">
                          {t("editor.authorMetadata")}
                        </Label>
                        <Input
                          value={draft.values.authorMetadata}
                          onChange={(event) =>
                            updateValues("authorMetadata", event.target.value)
                          }
                          aria-label={t("editor.authorMetadata")}
                        />
                      </div>
                    </div>
                  </EditorSection>

                  <EditorSection title={t("editor.sections.parameters")}>
                    <div className="space-y-2">
                      {draft.values.parameters.map((parameter, index) => (
                        <div
                          key={parameter.formId}
                          className="space-y-2 rounded-md border border-border p-2"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-medium">
                              {parameter.key || t("editor.parameter")}
                            </span>
                            <RemoveButton
                              onClick={() =>
                                removeListItem("parameters", index)
                              }
                            />
                          </div>
                          <div className="grid gap-2 sm:grid-cols-2">
                            <Input
                              value={parameter.key}
                              onChange={(event) =>
                                updateListItem("parameters", index, {
                                  ...parameter,
                                  key: event.target.value,
                                })
                              }
                              aria-label={t("editor.parameterKey")}
                              placeholder={t("editor.parameterKey")}
                            />
                            <Select
                              value={parameter.inputType}
                              onValueChange={(value) =>
                                updateListItem("parameters", index, {
                                  ...parameter,
                                  inputType: value,
                                })
                              }
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {PARAMETER_INPUT_TYPES.map((type) => (
                                  <SelectItem key={type} value={type}>
                                    {type}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Select
                              value={parameter.requirement}
                              onValueChange={(value) =>
                                updateListItem("parameters", index, {
                                  ...parameter,
                                  requirement: value,
                                })
                              }
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {PARAMETER_REQUIREMENTS.map((requirement) => (
                                  <SelectItem
                                    key={requirement}
                                    value={requirement}
                                  >
                                    {requirement}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Input
                              value={parameter.defaultValue}
                              onChange={(event) =>
                                updateListItem("parameters", index, {
                                  ...parameter,
                                  defaultValue: event.target.value,
                                })
                              }
                              aria-label={t("editor.parameterDefault")}
                              placeholder={t("editor.parameterDefault")}
                            />
                          </div>
                          <Textarea
                            value={parameter.description}
                            onChange={(event) =>
                              updateListItem("parameters", index, {
                                ...parameter,
                                description: event.target.value,
                              })
                            }
                            aria-label={t("editor.parameterDescription")}
                            rows={2}
                            placeholder={t("editor.parameterDescription")}
                          />
                          <Input
                            value={parameter.options}
                            onChange={(event) =>
                              updateListItem("parameters", index, {
                                ...parameter,
                                options: event.target.value,
                              })
                            }
                            aria-label={t("editor.parameterOptions")}
                            placeholder={t(
                              "editor.parameterOptionsPlaceholder",
                            )}
                          />
                        </div>
                      ))}
                      <Button
                        type="button"
                        size="xs"
                        variant="outline-flat"
                        onClick={() =>
                          addListItem("parameters", defaultParameter())
                        }
                      >
                        <Plus className="size-3.5" />
                        {t("editor.addParameter")}
                      </Button>
                    </div>
                  </EditorSection>

                  <EditorSection title={t("editor.sections.response")}>
                    <Textarea
                      value={draft.values.responseJsonSchema}
                      onChange={(event) =>
                        updateValues("responseJsonSchema", event.target.value)
                      }
                      aria-label={t("editor.responseJsonSchema")}
                      rows={6}
                      className="font-mono text-xs"
                      placeholder='{"type":"object","properties":{}}'
                    />
                  </EditorSection>

                  <EditorSection title={t("editor.sections.subRecipes")}>
                    <div className="space-y-2">
                      {draft.values.subRecipes.map((subRecipe, index) => (
                        <div
                          key={subRecipe.formId}
                          className="space-y-2 rounded-md border border-border p-2"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-medium">
                              {subRecipe.name || t("editor.subRecipe")}
                            </span>
                            <RemoveButton
                              onClick={() =>
                                removeListItem("subRecipes", index)
                              }
                            />
                          </div>
                          <div className="grid gap-2 sm:grid-cols-2">
                            <Input
                              value={subRecipe.name}
                              onChange={(event) =>
                                updateListItem("subRecipes", index, {
                                  ...subRecipe,
                                  name: event.target.value,
                                })
                              }
                              aria-label={t("editor.subRecipeName")}
                              placeholder={t("editor.subRecipeName")}
                            />
                            <Input
                              value={subRecipe.path}
                              onChange={(event) =>
                                updateListItem("subRecipes", index, {
                                  ...subRecipe,
                                  path: event.target.value,
                                })
                              }
                              aria-label={t("editor.subRecipePath")}
                              placeholder="./child.yaml"
                            />
                          </div>
                          <Textarea
                            value={subRecipe.values}
                            onChange={(event) =>
                              updateListItem("subRecipes", index, {
                                ...subRecipe,
                                values: event.target.value,
                              })
                            }
                            aria-label={t("editor.subRecipeValues")}
                            rows={4}
                            className="font-mono text-xs"
                            placeholder='{"topic":"release"}'
                          />
                          <Input
                            value={subRecipe.description}
                            onChange={(event) =>
                              updateListItem("subRecipes", index, {
                                ...subRecipe,
                                description: event.target.value,
                              })
                            }
                            aria-label={t("editor.subRecipeDescription")}
                            placeholder={t("editor.subRecipeDescription")}
                          />
                          <label className="flex items-center gap-2 text-xs text-muted-foreground">
                            <input
                              type="checkbox"
                              checked={subRecipe.sequentialWhenRepeated}
                              onChange={(event) =>
                                updateListItem("subRecipes", index, {
                                  ...subRecipe,
                                  sequentialWhenRepeated: event.target.checked,
                                })
                              }
                            />
                            {t("editor.sequentialWhenRepeated")}
                          </label>
                        </div>
                      ))}
                      <Button
                        type="button"
                        size="xs"
                        variant="outline-flat"
                        onClick={() =>
                          addListItem("subRecipes", defaultSubRecipe())
                        }
                      >
                        <Plus className="size-3.5" />
                        {t("editor.addSubRecipe")}
                      </Button>
                    </div>
                  </EditorSection>

                  <EditorSection title={t("editor.sections.retry")}>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <Input
                        value={draft.values.retryMaxRetries}
                        onChange={(event) =>
                          updateValues("retryMaxRetries", event.target.value)
                        }
                        aria-label={t("editor.retryMaxRetries")}
                        inputMode="numeric"
                        placeholder={t("editor.retryMaxRetries")}
                      />
                      <Input
                        value={draft.values.retryTimeoutSeconds}
                        onChange={(event) =>
                          updateValues(
                            "retryTimeoutSeconds",
                            event.target.value,
                          )
                        }
                        aria-label={t("editor.retryTimeoutSeconds")}
                        inputMode="numeric"
                        placeholder={t("editor.retryTimeoutSeconds")}
                      />
                      <Input
                        value={draft.values.retryOnFailureTimeoutSeconds}
                        onChange={(event) =>
                          updateValues(
                            "retryOnFailureTimeoutSeconds",
                            event.target.value,
                          )
                        }
                        aria-label={t("editor.retryOnFailureTimeoutSeconds")}
                        inputMode="numeric"
                        placeholder={t("editor.retryOnFailureTimeoutSeconds")}
                      />
                    </div>
                    <Input
                      value={draft.values.retryOnFailure}
                      onChange={(event) =>
                        updateValues("retryOnFailure", event.target.value)
                      }
                      aria-label={t("editor.retryOnFailure")}
                      placeholder={t("editor.retryOnFailure")}
                    />
                    <div className="space-y-2">
                      {draft.values.retryChecks.map((check, index) => (
                        <div
                          key={check.formId}
                          className="flex items-center gap-2"
                        >
                          <Input
                            value={check.command}
                            onChange={(event) =>
                              updateListItem("retryChecks", index, {
                                ...check,
                                command: event.target.value,
                              })
                            }
                            aria-label={t("editor.retryCheckCommand")}
                            placeholder={t("editor.retryCheckCommand")}
                          />
                          <RemoveButton
                            onClick={() => removeListItem("retryChecks", index)}
                          />
                        </div>
                      ))}
                      <Button
                        type="button"
                        size="xs"
                        variant="outline-flat"
                        onClick={() =>
                          addListItem("retryChecks", defaultRetryCheck())
                        }
                      >
                        <Plus className="size-3.5" />
                        {t("editor.addRetryCheck")}
                      </Button>
                    </div>
                  </EditorSection>

                  <EditorSection title={t("editor.sections.extensions")}>
                    <div className="space-y-2">
                      {draft.values.extensions.map((extension, index) => (
                        <div
                          key={extension.formId}
                          className="space-y-2 rounded-md border border-border p-2"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-medium">
                              {extension.name || t("editor.extension")}
                            </span>
                            <RemoveButton
                              onClick={() =>
                                removeListItem("extensions", index)
                              }
                            />
                          </div>
                          <div className="grid gap-2 sm:grid-cols-2">
                            <Select
                              value={recipeExtensionSelectValue(extension)}
                              onValueChange={(value) =>
                                handleSelectRecipeExtension(
                                  index,
                                  value,
                                  extension,
                                )
                              }
                            >
                              <SelectTrigger
                                aria-label={t("editor.extensionName")}
                              >
                                <SelectValue
                                  placeholder={t("editor.selectExtension")}
                                />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value={NO_EXTENSION_VALUE} disabled>
                                  {t("editor.selectExtension")}
                                </SelectItem>
                                {selectableExtensions.map((configured) => (
                                  <SelectItem
                                    key={configured.config_key}
                                    value={configuredExtensionSelectValue(
                                      configured,
                                    )}
                                  >
                                    {getDisplayName(configured)}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Textarea
                              value={extension.availableTools}
                              onChange={(event) =>
                                updateListItem("extensions", index, {
                                  ...extension,
                                  availableTools: event.target.value,
                                })
                              }
                              aria-label={t("editor.extensionAvailableTools")}
                              rows={3}
                              placeholder={t("editor.extensionAvailableTools")}
                            />
                          </div>
                        </div>
                      ))}
                      <Button
                        type="button"
                        size="xs"
                        variant="outline-flat"
                        onClick={handleAddRecipeExtension}
                      >
                        <Plus className="size-3.5" />
                        {t("editor.addExtension")}
                      </Button>
                    </div>
                  </EditorSection>
                </div>
              )}
            </div>
          </div>
        </div>

        <ConfirmDialog
          open={Boolean(deletingRecipe)}
          onOpenChange={(open) => {
            if (!open) setDeletingRecipe(null);
          }}
          title={t("view.deleteTitle")}
          description={t("view.deleteDescription", {
            name: deletingRecipe?.title ?? "",
          })}
          cancelLabel={t("common:actions.cancel")}
          confirmLabel={t("common:actions.delete")}
          onConfirm={handleConfirmDelete}
        />
      </SettingsPage>
    </PageShell>
  );
}
