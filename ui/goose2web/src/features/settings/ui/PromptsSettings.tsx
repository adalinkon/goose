import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { SettingsPage } from "@/shared/ui/SettingsPage";
import { Button } from "@/shared/ui/button";
import { Textarea } from "@/shared/ui/textarea";
import { Spinner } from "@/shared/ui/spinner";
import {
  getPrompt,
  listPrompts,
  resetPrompt,
  savePrompt,
  type PromptTemplate,
} from "@/shared/api/prompts";
import { cn } from "@/shared/lib/cn";

export function PromptsSettings() {
  const { t } = useTranslation(["settings", "common"]);
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [isCustomized, setIsCustomized] = useState(false);
  const [baselineContent, setBaselineContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [loadingContent, setLoadingContent] = useState(false);

  const loadTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const prompts = await listPrompts();
      setTemplates(prompts);
      setSelectedName((prev) =>
        prev && prompts.some((template) => template.name === prev)
          ? prev
          : (prompts[0]?.name ?? null),
      );
    } catch (error) {
      setTemplates([]);
      setSelectedName(null);
      toast.error(
        error instanceof Error ? error.message : t("prompts.errors.loadFailed"),
      );
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadTemplates();
  }, [loadTemplates]);

  useEffect(() => {
    if (!selectedName) {
      setContent("");
      setIsCustomized(false);
      setBaselineContent("");
      return;
    }

    let active = true;
    setLoadingContent(true);
    void getPrompt(selectedName)
      .then((prompt) => {
        if (!active) return;
        setContent(prompt.content);
        setIsCustomized(prompt.isCustomized);
        setBaselineContent(prompt.content);
      })
      .catch((error) => {
        if (!active) return;
        toast.error(
          error instanceof Error
            ? error.message
            : t("prompts.errors.loadPromptFailed"),
        );
      })
      .finally(() => {
        if (!active) return;
        setLoadingContent(false);
      });

    return () => {
      active = false;
    };
  }, [selectedName, t]);

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.name === selectedName) ?? null,
    [selectedName, templates],
  );

  const canSave =
    !!selectedName &&
    !loadingContent &&
    !saving &&
    !resetting &&
    content.trim().length > 0 &&
    content !== baselineContent;

  const canReset =
    !!selectedName && !loadingContent && !saving && !resetting && isCustomized;

  const handleSave = async () => {
    if (!selectedName || !canSave) {
      return;
    }

    setSaving(true);
    try {
      await savePrompt(selectedName, content);
      const prompt = await getPrompt(selectedName);
      setContent(prompt.content);
      setIsCustomized(prompt.isCustomized);
      setBaselineContent(prompt.content);
      setTemplates((prev) =>
        prev.map((template) =>
          template.name === selectedName
            ? {
                ...template,
                user_content: prompt.isCustomized ? prompt.content : undefined,
                is_customized: prompt.isCustomized,
              }
            : template,
        ),
      );
      toast.success(t("prompts.saved"));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("prompts.errors.saveFailed"),
      );
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (!selectedName || !canReset) {
      return;
    }

    setResetting(true);
    try {
      await resetPrompt(selectedName);
      const prompt = await getPrompt(selectedName);
      setContent(prompt.content);
      setIsCustomized(prompt.isCustomized);
      setBaselineContent(prompt.content);
      setTemplates((prev) =>
        prev.map((template) =>
          template.name === selectedName
            ? {
                ...template,
                user_content: undefined,
                is_customized: false,
              }
            : template,
        ),
      );
      toast.success(t("prompts.reset"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("prompts.errors.resetFailed"),
      );
    } finally {
      setResetting(false);
    }
  };

  return (
    <SettingsPage
      title={t("prompts.title")}
      description={t("prompts.description")}
      actions={
        <>
          <Button
            type="button"
            variant="outline"
            size="xs"
            disabled={!canReset}
            onClick={() => {
              void handleReset();
            }}
          >
            {resetting ? t("prompts.resetting") : t("prompts.resetAction")}
          </Button>
          <Button
            type="button"
            size="xs"
            disabled={!canSave}
            onClick={() => {
              void handleSave();
            }}
          >
            {saving ? t("prompts.saving") : t("common:actions.save")}
          </Button>
        </>
      }
    >
      <div className="grid gap-3 md:grid-cols-[16rem_minmax(0,1fr)]">
        <div className="rounded-lg border border-border p-2">
          {loading ? (
            <div className="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground">
              <Spinner className="size-3.5" />
              <span>{t("prompts.loading")}</span>
            </div>
          ) : templates.length === 0 ? (
            <p className="px-2 py-3 text-xs text-muted-foreground">
              {t("prompts.empty")}
            </p>
          ) : (
            <div className="space-y-1">
              {templates.map((template) => {
                const selected = template.name === selectedName;
                return (
                  <button
                    type="button"
                    key={template.name}
                    onClick={() => setSelectedName(template.name)}
                    className={cn(
                      "w-full rounded-md border px-2 py-1.5 text-left",
                      selected
                        ? "border-border bg-muted text-foreground"
                        : "border-transparent text-muted-foreground hover:border-border hover:bg-muted/40 hover:text-foreground",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs font-medium">
                        {template.name}
                      </span>
                      {template.is_customized ? (
                        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                          {t("prompts.customized")}
                        </span>
                      ) : null}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="rounded-lg border border-border p-3">
          {!selectedTemplate ? (
            <p className="text-xs text-muted-foreground">
              {t("prompts.empty")}
            </p>
          ) : loadingContent ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Spinner className="size-3.5" />
              <span>{t("prompts.loadingPrompt")}</span>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-1">
                <h4 className="text-sm font-semibold">
                  {selectedTemplate.name}
                </h4>
                <p className="text-xs text-muted-foreground">
                  {selectedTemplate.description}
                </p>
              </div>

              <Textarea
                value={content}
                onChange={(event) => setContent(event.target.value)}
                rows={18}
                className="min-h-[360px] font-mono text-xs"
                aria-label={t("prompts.editorLabel", {
                  name: selectedTemplate.name,
                })}
              />
            </div>
          )}
        </div>
      </div>
    </SettingsPage>
  );
}
