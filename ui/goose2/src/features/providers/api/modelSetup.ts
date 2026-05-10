import type { ProviderConfigChangeResponse } from "@aaif/goose-sdk";
import { authenticateProviderConfig } from "./credentials";

export async function authenticateModelProvider(
  providerId: string,
  providerLabel: string,
): Promise<ProviderConfigChangeResponse> {
  void providerLabel;
  return authenticateProviderConfig(providerId);
}

export function onModelSetupOutput(
  providerId: string,
  callback: (line: string) => void,
): Promise<() => void> {
  void providerId;
  void callback;
  return Promise.resolve(() => {});
}
