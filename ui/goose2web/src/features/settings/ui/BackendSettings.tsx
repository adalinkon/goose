import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { getClient } from "@/shared/api/acpConnection";
import {
  clearStoredBackendUrl,
  getStoredBackendUrl,
  setStoredBackendUrl,
} from "@/shared/api/backendConfig";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";

export function BackendSettings() {
  const { t } = useTranslation(["settings", "common"]);
  const [backendUrl, setBackendUrl] = useState(
    () => getStoredBackendUrl() ?? "",
  );
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const normalizedUrl = useMemo(() => backendUrl.trim(), [backendUrl]);

  const onSave = async () => {
    setSaving(true);
    try {
      if (normalizedUrl) {
        setStoredBackendUrl(normalizedUrl);
        toast.success(t("settings:backend.saved"));
      } else {
        clearStoredBackendUrl();
        toast.success(t("settings:backend.cleared"));
      }
    } finally {
      setSaving(false);
    }
  };

  const onTest = async () => {
    if (!normalizedUrl) return;
    setTesting(true);
    try {
      setStoredBackendUrl(normalizedUrl);
      await getClient();
      toast.success(t("settings:backend.connected"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("settings:backend.connectFailed"),
      );
    } finally {
      setTesting(false);
    }
  };

  return (
    <section className="space-y-4 py-4">
      <div className="space-y-1">
        <h3 className="text-lg font-semibold">{t("settings:backend.title")}</h3>
        <p className="text-sm text-muted-foreground">
          {t("settings:backend.description")}
        </p>
      </div>

      <div className="space-y-2">
        <label className="block text-sm font-medium" htmlFor="backend-url">
          {t("settings:backend.urlLabel")}
        </label>
        <Input
          id="backend-url"
          value={backendUrl}
          onChange={(event) => setBackendUrl(event.target.value)}
          placeholder={t("settings:backend.urlPlaceholder")}
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      <div className="flex gap-2">
        <Button type="button" onClick={onSave} disabled={saving}>
          {t("common:actions.save")}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={onTest}
          disabled={testing || !normalizedUrl}
        >
          {t("settings:backend.test")}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setBackendUrl("")}>
          {t("common:actions.clear")}
        </Button>
      </div>
    </section>
  );
}
