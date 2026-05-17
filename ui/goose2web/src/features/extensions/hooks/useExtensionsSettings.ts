import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  addExtension,
  listExtensions,
  removeExtension,
  toggleExtension,
} from "../api/extensions";
import { nameToKey } from "../lib/extensionKeys";
import type { ExtensionConfig, ExtensionEntry } from "../types";

type ExtensionModalMode = "add" | "edit" | null;

export function useExtensionsSettings() {
  const { t } = useTranslation("settings");
  const [extensions, setExtensions] = useState<ExtensionEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [modalMode, setModalMode] = useState<ExtensionModalMode>(null);
  const [editingExtension, setEditingExtension] =
    useState<ExtensionEntry | null>(null);
  const [detailExtension, setDetailExtension] = useState<ExtensionEntry | null>(
    null,
  );
  const [togglingKeys, setTogglingKeys] = useState<Set<string>>(
    () => new Set(),
  );

  const refreshExtensions = useCallback(async () => {
    try {
      const result = await listExtensions();
      setExtensions(result);
      setDetailExtension((current) =>
        current
          ? (result.find((item) => item.config_key === current.config_key) ??
            current)
          : null,
      );
    } catch {
      setExtensions([]);
    }
  }, []);

  const fetchExtensions = useCallback(async () => {
    setIsLoading(true);
    try {
      await refreshExtensions();
    } finally {
      setIsLoading(false);
    }
  }, [refreshExtensions]);

  useEffect(() => {
    void fetchExtensions();
  }, [fetchExtensions]);

  const handleAdd = useCallback(() => {
    setEditingExtension(null);
    setModalMode("add");
  }, []);

  const handleConfigure = useCallback((extension: ExtensionEntry) => {
    setEditingExtension(extension);
    setModalMode("edit");
  }, []);

  const handleShowDetails = useCallback((extension: ExtensionEntry) => {
    setDetailExtension(extension);
  }, []);

  const handleSubmit = useCallback(
    async (name: string, config: ExtensionConfig) => {
      try {
        const newKey = nameToKey(name);
        const isEdit = !!editingExtension;
        const isAdd = !editingExtension;
        const keyChanged = isEdit && editingExtension.config_key !== newKey;

        if (
          (isAdd || keyChanged) &&
          extensions.some((extension) => extension.config_key === newKey)
        ) {
          toast.error(t("extensions.errors.nameConflict", { name }));
          return;
        }

        await addExtension(name, config, editingExtension?.enabled ?? false);
        if (keyChanged) {
          await removeExtension(editingExtension.config_key);
        }
        setModalMode(null);
        setEditingExtension(null);
        await refreshExtensions();
      } catch {
        await refreshExtensions();
        toast.error(t("extensions.errors.saveFailed"));
      }
    },
    [editingExtension, extensions, refreshExtensions, t],
  );

  const handleDelete = useCallback(
    async (configKey: string) => {
      try {
        await removeExtension(configKey);
        setModalMode(null);
        setEditingExtension(null);
        await refreshExtensions();
      } catch (error) {
        toast.error(t("extensions.errors.deleteFailed"));
        throw error;
      }
    },
    [refreshExtensions, t],
  );

  const handleToggle = useCallback(
    async (extension: ExtensionEntry, enabled: boolean) => {
      const previousExtensions = extensions;
      setTogglingKeys((current) => new Set(current).add(extension.config_key));
      setExtensions((current) =>
        current.map((item) =>
          item.config_key === extension.config_key
            ? { ...item, enabled }
            : item,
        ),
      );

      try {
        await toggleExtension(extension.config_key, enabled);
      } catch {
        setExtensions(previousExtensions);
        toast.error(t("extensions.errors.toggleFailed"));
      } finally {
        setTogglingKeys((current) => {
          const next = new Set(current);
          next.delete(extension.config_key);
          return next;
        });
      }
    },
    [extensions, t],
  );

  const handleUpdateTools = useCallback(
    async (extension: ExtensionEntry, config: ExtensionConfig) => {
      try {
        await addExtension(extension.name, config, extension.enabled);
        setDetailExtension(null);
        await refreshExtensions();
      } catch {
        toast.error(t("extensions.errors.saveFailed"));
      }
    },
    [refreshExtensions, t],
  );

  const handleModalClose = useCallback(() => {
    setModalMode(null);
    setEditingExtension(null);
  }, []);

  const handleDetailClose = useCallback(() => {
    setDetailExtension(null);
  }, []);

  return {
    extensions,
    isLoading,
    modalMode,
    editingExtension,
    detailExtension,
    handleAdd,
    handleConfigure,
    handleShowDetails,
    handleSubmit,
    handleDelete,
    handleToggle,
    handleUpdateTools,
    handleModalClose,
    handleDetailClose,
    togglingKeys,
  };
}
