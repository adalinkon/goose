import { useCallback, type RefObject } from "react";
import { useTranslation } from "react-i18next";

interface UseChatInputFilePickerOptions {
  disabled: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  addPathAttachments: (paths: string[]) => Promise<void>;
}

export function useChatInputFilePicker({
  disabled,
  fileInputRef,
  addPathAttachments,
}: UseChatInputFilePickerOptions) {
  const { t } = useTranslation("chat");

  const handleAttachFiles = useCallback(() => {
    if (disabled) {
      return;
    }

    fileInputRef.current?.click();
  }, [disabled, fileInputRef]);

  const handleAttachFolders = useCallback(async () => {
    if (disabled) {
      return;
    }

    const path = window.prompt(t("attachments.remotePathPrompt"));
    const trimmedPath = path?.trim();
    if (trimmedPath) {
      await addPathAttachments([trimmedPath]);
    }
  }, [addPathAttachments, disabled, t]);

  return { handleAttachFiles, handleAttachFolders };
}
