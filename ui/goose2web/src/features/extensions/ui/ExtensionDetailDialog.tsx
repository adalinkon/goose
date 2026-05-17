import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Checkbox } from "@/shared/ui/checkbox";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import {
  extensionConfigWithAvailableTools,
  getDisplayName,
  getExtensionAvailableTools,
  getExtensionToolInfos,
  type ExtensionConfig,
  type ExtensionEntry,
} from "../types";

interface ExtensionDetailDialogProps {
  extension: ExtensionEntry;
  onClose: () => void;
  onSaveTools: (
    extension: ExtensionEntry,
    config: ExtensionConfig,
  ) => Promise<void>;
}

function extensionDetailRows(extension: ExtensionEntry) {
  const rows: Array<{ label: string; value: string }> = [
    { label: "Type", value: extension.type },
  ];

  if (extension.type === "stdio") {
    rows.push({ label: "Command", value: extension.cmd });
    if (extension.args.length > 0) {
      rows.push({ label: "Arguments", value: extension.args.join(" ") });
    }
  }
  if (extension.type === "streamable_http" || extension.type === "sse") {
    rows.push({ label: "URI", value: extension.uri ?? "" });
  }
  if ("timeout" in extension && extension.timeout) {
    rows.push({ label: "Timeout", value: `${extension.timeout}s` });
  }

  return rows.filter((row) => row.value);
}

function initialSelectedTools(extension: ExtensionEntry) {
  const configured = getExtensionAvailableTools(extension);
  if (configured.length > 0) return configured;
  return getExtensionToolInfos(extension).map((tool) => tool.name);
}

export function ExtensionDetailDialog({
  extension,
  onClose,
  onSaveTools,
}: ExtensionDetailDialogProps) {
  const { t } = useTranslation("settings");
  const [selectedTools, setSelectedTools] = useState<Set<string>>(
    () => new Set(initialSelectedTools(extension)),
  );
  const [isSaving, setIsSaving] = useState(false);
  const displayName = getDisplayName(extension);
  const tools = useMemo(() => getExtensionToolInfos(extension), [extension]);
  const rows = useMemo(() => extensionDetailRows(extension), [extension]);
  const allToolNames = tools.map((tool) => tool.name);
  const currentlyConfiguredTools = getExtensionAvailableTools(extension);
  const effectiveConfiguredTools =
    currentlyConfiguredTools.length > 0
      ? currentlyConfiguredTools
      : allToolNames;
  const hasToolInventory = tools.length > 0;
  const selectedToolNames = [...selectedTools];
  const toolsChanged =
    selectedToolNames.length !== effectiveConfiguredTools.length ||
    selectedToolNames.some((tool) => !effectiveConfiguredTools.includes(tool));

  useEffect(() => {
    setSelectedTools(new Set(initialSelectedTools(extension)));
  }, [extension]);

  const toggleTool = (toolName: string, checked: boolean) => {
    setSelectedTools((current) => {
      const next = new Set(current);
      if (checked) next.add(toolName);
      else next.delete(toolName);
      return next;
    });
  };

  const selectAllTools = () => {
    setSelectedTools(new Set(allToolNames));
  };

  const clearTools = () => {
    setSelectedTools(new Set());
  };

  const handleSave = async () => {
    if (!toolsChanged || isSaving) return;
    setIsSaving(true);
    try {
      await onSaveTools(
        extension,
        extensionConfigWithAvailableTools(extension, selectedToolNames),
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{displayName}</DialogTitle>
          <DialogDescription>
            {extension.description || t("extensions.details.noDescription")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <dl className="grid gap-2 rounded-lg border border-border p-3 text-sm sm:grid-cols-2">
            {rows.map((row) => (
              <div key={row.label} className="min-w-0">
                <dt className="text-xs text-muted-foreground">{row.label}</dt>
                <dd className="truncate text-foreground">{row.value}</dd>
              </div>
            ))}
          </dl>

          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h4 className="text-sm font-medium">
                  {t("extensions.details.toolsTitle")}
                </h4>
                <p className="text-xs text-muted-foreground">
                  {t("extensions.details.toolsDescription")}
                </p>
              </div>
              {hasToolInventory ? (
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    onClick={selectAllTools}
                  >
                    {t("extensions.details.enableAllTools")}
                  </Button>
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    onClick={clearTools}
                  >
                    {t("extensions.details.disableAllTools")}
                  </Button>
                </div>
              ) : null}
            </div>

            {hasToolInventory ? (
              <div className="max-h-72 space-y-2 overflow-y-auto rounded-lg border border-border p-2">
                {tools.map((tool) => {
                  const checkboxId = `extension-tool-${extension.config_key}-${tool.name}`;
                  return (
                    <div
                      key={tool.name}
                      className="flex items-start gap-3 rounded-md p-2 hover:bg-muted/50"
                    >
                      <Checkbox
                        id={checkboxId}
                        checked={selectedTools.has(tool.name)}
                        onCheckedChange={(checked) =>
                          toggleTool(tool.name, checked === true)
                        }
                        aria-label={t("extensions.details.toggleTool", {
                          name: tool.name,
                        })}
                      />
                      <label htmlFor={checkboxId} className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {tool.name}
                        </span>
                        {tool.description ? (
                          <span className="mt-0.5 block text-xs text-muted-foreground">
                            {tool.description}
                          </span>
                        ) : null}
                      </label>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
                {t("extensions.details.noTools")}
              </p>
            )}
          </section>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={isSaving}
          >
            {t("extensions.cancel")}
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={!toolsChanged || isSaving || !hasToolInventory}
          >
            {isSaving ? t("extensions.saving") : t("extensions.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
