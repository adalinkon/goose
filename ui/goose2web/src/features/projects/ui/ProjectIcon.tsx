import { useState, type ComponentType } from "react";
import {
  IconApi,
  IconAppWindow,
  IconBolt,
  IconBook,
  IconBrain,
  IconBrandGithub,
  IconCode,
  IconComponents,
  IconDatabase,
  IconFolder,
  IconFolderCode,
  IconGitBranch,
  IconPackage,
  IconPalette,
  IconRocket,
  IconServer,
  IconSettings,
  IconTerminal2,
  IconWorld,
} from "@tabler/icons-react";
import { cn } from "@/shared/lib/cn";
import {
  DEFAULT_PROJECT_ICON,
  isImageProjectIcon,
  normalizeProjectIcon,
} from "../lib/projectIcons";

type TablerIconComponent = ComponentType<{
  className?: string;
  stroke?: number;
}>;

const tablerIconsByValue = new Map<string, TablerIconComponent>([
  [DEFAULT_PROJECT_ICON, IconFolderCode],
  ["tabler:code", IconCode],
  ["tabler:git-branch", IconGitBranch],
  ["tabler:brand-github", IconBrandGithub],
  ["tabler:terminal", IconTerminal2],
  ["tabler:server", IconServer],
  ["tabler:database", IconDatabase],
  ["tabler:api", IconApi],
  ["tabler:app-window", IconAppWindow],
  ["tabler:components", IconComponents],
  ["tabler:package", IconPackage],
  ["tabler:world", IconWorld],
  ["tabler:book", IconBook],
  ["tabler:palette", IconPalette],
  ["tabler:brain", IconBrain],
  ["tabler:bolt", IconBolt],
  ["tabler:rocket", IconRocket],
  ["tabler:settings", IconSettings],
]);

export function ProjectIcon({
  icon,
  className,
  imageClassName,
}: {
  icon: string | null | undefined;
  className?: string;
  imageClassName?: string;
}) {
  const normalizedIcon = normalizeProjectIcon(icon);
  const [failedImageIcon, setFailedImageIcon] = useState<string | null>(null);
  const imageFailed = failedImageIcon === normalizedIcon;

  if (isImageProjectIcon(normalizedIcon) && !imageFailed) {
    return (
      <img
        src={normalizedIcon}
        alt=""
        className={cn("size-4 rounded-[3px] object-contain", imageClassName)}
        onError={() => setFailedImageIcon(normalizedIcon)}
      />
    );
  }

  const Icon = tablerIconsByValue.get(normalizedIcon) ?? IconFolder;

  return <Icon className={cn("size-4", className)} stroke={1.8} />;
}
