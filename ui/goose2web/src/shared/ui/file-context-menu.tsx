import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/shared/ui/context-menu";

interface FileContextMenuProps {
  path: string;
  children: ReactNode;
}

export function FileContextMenu({ path, children }: FileContextMenuProps) {
  const { t } = useTranslation("common");

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          onSelect={() => void navigator.clipboard.writeText(path)}
        >
          {t("labels.copyPath")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
