import { useTranslation } from "react-i18next";
import { SettingsPage } from "@/shared/ui/SettingsPage";
import packageJson from "../../../../package.json";

function AboutInfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right text-sm font-medium">
        {value}
      </span>
    </div>
  );
}

export function AboutSettings() {
  const { t } = useTranslation("settings");

  return (
    <SettingsPage title={t("about.title")}>
      <div className="space-y-1">
        <div className="divide-y divide-border">
          <AboutInfoRow
            label={t("about.fields.name")}
            value={packageJson.name}
          />
          <AboutInfoRow
            label={t("about.fields.version")}
            value={packageJson.version}
          />
          <AboutInfoRow
            label={t("about.fields.buildMode")}
            value={
              import.meta.env.DEV
                ? t("about.buildModes.development")
                : t("about.buildModes.production")
            }
          />
          <AboutInfoRow label={t("about.fields.license")} value="Apache-2.0" />
        </div>
      </div>
    </SettingsPage>
  );
}
