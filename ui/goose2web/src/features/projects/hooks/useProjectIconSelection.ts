import { useCallback, useEffect, useMemo, useState } from "react";
import { scanProjectIcons, type ProjectIconCandidate } from "../api/projects";
import {
  DEFAULT_PROJECT_ICON,
  normalizeProjectIcon,
} from "../lib/projectIcons";
import { parseEditorText } from "../lib/projectPromptText";

const CUSTOM_ICON_MAX_BYTES = 512 * 1024;
const CUSTOM_ICON_MIME_TYPES = new Set([
  "image/svg+xml",
  "image/png",
  "image/x-icon",
  "image/vnd.microsoft.icon",
  "image/jpeg",
  "image/webp",
]);

async function readFileAsDataUrl(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return `data:${file.type};base64,${btoa(binary)}`;
}

export function useProjectIconSelection({
  isOpen,
  prompt,
}: {
  isOpen: boolean;
  prompt: string;
}) {
  const [icon, setIcon] = useState(DEFAULT_PROJECT_ICON);
  const [iconError, setIconError] = useState<string | null>(null);
  const [iconCandidates, setIconCandidates] = useState<ProjectIconCandidate[]>(
    [],
  );
  const [iconScanPending, setIconScanPending] = useState(false);

  const scannedWorkingDirKey = useMemo(
    () => parseEditorText(prompt).workingDirs.join("\n"),
    [prompt],
  );

  useEffect(() => {
    const workingDirs = scannedWorkingDirKey.split("\n").filter(Boolean);
    if (!isOpen || workingDirs.length === 0) {
      setIconCandidates([]);
      setIconScanPending(false);
      return;
    }

    let active = true;
    setIconScanPending(true);
    const timeout = window.setTimeout(() => {
      scanProjectIcons(workingDirs)
        .then((candidates) => {
          if (active) {
            setIconCandidates(candidates);
          }
        })
        .catch(() => {
          if (active) {
            setIconCandidates([]);
          }
        })
        .finally(() => {
          if (active) {
            setIconScanPending(false);
          }
        });
    }, 250);

    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [isOpen, scannedWorkingDirKey]);

  const resetIcon = useCallback((nextIcon?: string | null) => {
    setIcon(normalizeProjectIcon(nextIcon));
    setIconError(null);
  }, []);

  const chooseIcon = useCallback((nextIcon: string) => {
    setIcon(nextIcon);
    setIconError(null);
  }, []);

  const chooseCustomIcon = useCallback(async (file: File) => {
    try {
      if (!CUSTOM_ICON_MIME_TYPES.has(file.type)) {
        throw new Error("Unsupported icon file type");
      }
      if (file.size > CUSTOM_ICON_MAX_BYTES) {
        throw new Error("Icon file is too large");
      }
      const iconDataUrl = await readFileAsDataUrl(file);
      setIcon(iconDataUrl);
      setIconError(null);
    } catch (err) {
      setIconError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  return {
    icon,
    iconCandidates,
    iconScanPending,
    iconError,
    chooseIcon,
    chooseCustomIcon,
    resetIcon,
  };
}
