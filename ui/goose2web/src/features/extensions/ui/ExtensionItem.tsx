import { useTranslation } from "react-i18next";
import { IconSettings } from "@tabler/icons-react";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { Switch } from "@/shared/ui/switch";
import { getDisplayName, type ExtensionEntry } from "../types";

interface ExtensionItemProps {
  extension: ExtensionEntry;
  onDetails?: (extension: ExtensionEntry) => void;
  onConfigure?: (extension: ExtensionEntry) => void;
  onToggle?: (extension: ExtensionEntry, enabled: boolean) => void;
  isToggling?: boolean;
  className?: string;
}

function getSubtitle(ext: ExtensionEntry): string {
  if (ext.description) return ext.description;
  if (ext.type === "stdio") return ext.cmd;
  if (ext.type === "streamable_http") return ext.uri;
  return ext.type;
}

function isUserManagedExtension(ext: ExtensionEntry): boolean {
  return (
    (ext.type === "stdio" || ext.type === "streamable_http") && !ext.bundled
  );
}

function isEditable(ext: ExtensionEntry): boolean {
  return isUserManagedExtension(ext);
}

export function ExtensionItem({
  extension,
  onDetails,
  onConfigure,
  onToggle,
  isToggling = false,
  className,
}: ExtensionItemProps) {
  const { t } = useTranslation("settings");
  const editable = isEditable(extension);
  const displayName = getDisplayName(extension);

  return (
    <div
      className={cn(
        "flex min-h-20 w-full items-center justify-between gap-3 border-b border-border-soft-divider py-4 text-left transition-colors hover:bg-muted/30",
        className,
      )}
    >
      <button
        type="button"
        onClick={() => onDetails?.(extension)}
        className="min-w-0 flex-1 text-left"
      >
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{displayName}</span>
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {getSubtitle(extension)}
        </p>
      </button>
      <div className="flex shrink-0 items-center gap-2">
        {onToggle ? (
          <Switch
            checked={extension.enabled}
            disabled={isToggling}
            onClick={(event) => event.stopPropagation()}
            onCheckedChange={(enabled) => onToggle(extension, enabled)}
            aria-label={t(
              extension.enabled
                ? "extensions.disableExtension"
                : "extensions.enableExtension",
              { name: displayName },
            )}
          />
        ) : null}
        {editable && onConfigure && (
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={(event) => {
              event.stopPropagation();
              onConfigure(extension);
            }}
            aria-label={t("extensions.configure", {
              name: displayName,
            })}
          >
            <IconSettings className="size-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
