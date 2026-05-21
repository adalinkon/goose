import type { ComponentType } from "react";
import {
  Mic,
  Settings2,
  FolderKanban,
  MessageSquare,
  Stethoscope,
  FileText,
} from "lucide-react";
import { IconPlug } from "@tabler/icons-react";

export const SETTINGS_SECTIONS = [
  { id: "general", labelKey: "nav.general", icon: Settings2 },
  { id: "providers", labelKey: "nav.providers", icon: IconPlug },
  { id: "voice", labelKey: "nav.voice", icon: Mic },
  { id: "projects", labelKey: "nav.projects", icon: FolderKanban },
  { id: "chats", labelKey: "nav.chats", icon: MessageSquare },
  { id: "prompts", labelKey: "nav.prompts", icon: FileText },
  { id: "doctor", labelKey: "nav.doctor", icon: Stethoscope },
] as const satisfies readonly {
  id: string;
  labelKey: string;
  icon: ComponentType<{ className?: string }>;
}[];

export type SectionId = (typeof SETTINGS_SECTIONS)[number]["id"];

export const DEFAULT_SETTINGS_SECTION: SectionId = "general";

export function isSettingsSection(section: string): section is SectionId {
  return SETTINGS_SECTIONS.some((item) => item.id === section);
}

export function normalizeSettingsSection(section: string): SectionId {
  if (isSettingsSection(section)) {
    return section;
  }

  if (
    section === "appearance" ||
    section === "compaction" ||
    section === "about"
  ) {
    return "general";
  }

  return DEFAULT_SETTINGS_SECTION;
}
