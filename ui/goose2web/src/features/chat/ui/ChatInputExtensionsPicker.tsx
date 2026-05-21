import { useEffect, useMemo, useRef, useState } from "react";
import { IconCheck, IconChevronDown, IconPuzzle } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import type { SessionExtensionInfo } from "@/features/extensions/api/extensions";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";
import { ScrollArea } from "@/shared/ui/scroll-area";
import { Spinner } from "@/shared/ui/spinner";
import { PickerItem } from "./AgentModelPickerItem";

interface ChatInputExtensionsPickerProps {
  extensions: SessionExtensionInfo[];
  loading?: boolean;
  error?: boolean;
  isCompact?: boolean;
}

function extensionStatusClassName(status: SessionExtensionInfo["status"]) {
  switch (status) {
    case "running":
      return "bg-border-success";
    case "starting":
      return "bg-border-warning";
    case "failed":
    case "stopped":
      return "bg-destructive";
  }
}

export function ChatInputExtensionsPicker({
  extensions,
  loading = false,
  error = false,
  isCompact = false,
}: ChatInputExtensionsPickerProps) {
  const { t } = useTranslation("chat");
  const [open, setOpen] = useState(false);
  const [selectedExtensionName, setSelectedExtensionName] = useState<
    string | null
  >(extensions[0]?.name ?? null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (
      selectedExtensionName &&
      extensions.some((extension) => extension.name === selectedExtensionName)
    ) {
      return;
    }
    setSelectedExtensionName(extensions[0]?.name ?? null);
  }, [extensions, selectedExtensionName]);

  const selectedExtension = useMemo(
    () =>
      extensions.find(
        (extension) => extension.name === selectedExtensionName,
      ) ??
      extensions[0] ??
      null,
    [extensions, selectedExtensionName],
  );

  const hasStarting = extensions.some(
    (extension) => extension.status === "starting",
  );
  const hasFailed = extensions.some(
    (extension) =>
      extension.status === "failed" || extension.status === "stopped",
  );
  const disabled = loading && extensions.length === 0;
  const triggerLabel =
    extensions.length > 0
      ? t("toolbar.extensionsCount", { count: extensions.length })
      : loading
        ? t("toolbar.loading")
        : t("toolbar.extensions");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="toolbar"
          size="sm"
          aria-label={t("toolbar.chooseExtensionTool")}
          disabled={disabled}
          leftIcon={
            loading && extensions.length === 0 ? (
              <Spinner className="size-3.5" />
            ) : (
              <IconPuzzle className="size-3.5" />
            )
          }
          rightIcon={<IconChevronDown className="opacity-50" />}
          className="min-w-0 max-w-full"
          title={
            error
              ? t("toolbar.extensionsLoadError")
              : hasFailed
                ? t("toolbar.extensionsSomeUnavailable")
                : hasStarting
                  ? t("toolbar.extensionsStarting")
                  : undefined
          }
        >
          <span className={cn("truncate", isCompact ? "max-w-28" : "max-w-40")}>
            {triggerLabel}
          </span>
          {error || hasFailed || hasStarting ? (
            <span
              className={cn(
                "ml-1 size-1.5 shrink-0 rounded-full",
                error || hasFailed ? "bg-destructive" : "bg-text-warning",
              )}
            />
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        ref={contentRef}
        align="start"
        className="h-[min(24rem,50vh)] w-96 overflow-hidden p-1"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          contentRef.current
            ?.querySelector<HTMLElement>(
              '[data-col="extension"] button[data-selected]',
            )
            ?.focus();
        }}
        onKeyDown={(e) => {
          if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
          const col = (document.activeElement as HTMLElement)?.closest(
            "[data-col]",
          );
          if (!col) return;
          e.preventDefault();
          const items = Array.from(
            col.querySelectorAll<HTMLElement>("button:not(:disabled)"),
          );
          const idx = items.indexOf(document.activeElement as HTMLElement);
          const next =
            e.key === "ArrowDown"
              ? items[(idx + 1) % items.length]
              : items[(idx - 1 + items.length) % items.length];
          next?.focus();
        }}
      >
        <div className="grid h-full grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-1 overflow-hidden">
          <div
            data-col="extension"
            className="flex min-h-0 min-w-0 overflow-hidden p-1"
          >
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <div className="shrink-0 px-2 py-1.5 text-sm font-semibold">
                {t("toolbar.extensions")}
              </div>
              <ScrollArea className="min-h-0 min-w-0 flex-1">
                <div className="space-y-0.5 p-1">
                  {extensions.length > 0 ? (
                    extensions.map((extension) => {
                      const isSelected =
                        extension.name === selectedExtension?.name;
                      return (
                        <PickerItem
                          key={extension.name}
                          onClick={() =>
                            setSelectedExtensionName(extension.name)
                          }
                          selected={isSelected}
                          data-selected={isSelected || undefined}
                          title={t(
                            `toolbar.extensionStatus.${extension.status}`,
                          )}
                        >
                          <span
                            className={cn(
                              "size-2 shrink-0 rounded-full",
                              extensionStatusClassName(extension.status),
                            )}
                          />
                          <span className="min-w-0 flex-1 truncate">
                            {extension.name}
                          </span>
                          {isSelected ? (
                            <IconCheck className="size-4 shrink-0 text-muted-foreground" />
                          ) : null}
                        </PickerItem>
                      );
                    })
                  ) : (
                    <div className="px-2 py-2 text-sm text-muted-foreground">
                      {loading
                        ? t("toolbar.loadingExtensions")
                        : t("toolbar.noExtensionsAvailable")}
                    </div>
                  )}
                </div>
              </ScrollArea>
            </div>
          </div>

          <div
            data-col="tool"
            className="flex min-h-0 min-w-0 overflow-hidden p-1"
          >
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <div className="shrink-0 px-2 py-1.5 text-sm font-semibold">
                {t("toolbar.tools")}
              </div>
              <ScrollArea className="min-h-0 min-w-0 flex-1">
                <div className="space-y-0.5 p-1">
                  {selectedExtension?.tools.length ? (
                    selectedExtension.tools.map((tool) => (
                      <div
                        key={tool.name}
                        className="rounded-sm px-2 py-1.5 text-left text-sm"
                      >
                        <div className="truncate">{tool.name}</div>
                        {tool.description ? (
                          <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                            {tool.description}
                          </div>
                        ) : null}
                      </div>
                    ))
                  ) : (
                    <div className="px-2 py-2 text-sm text-muted-foreground">
                      {selectedExtension
                        ? t("toolbar.noToolsAvailable")
                        : t("toolbar.selectExtension")}
                    </div>
                  )}
                </div>
              </ScrollArea>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
