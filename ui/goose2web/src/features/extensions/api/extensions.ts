import { getClient } from "@/shared/api/acpConnection";
import type { ExtensionConfig, ExtensionEntry } from "../types";

export async function listExtensions(): Promise<ExtensionEntry[]> {
  const client = await getClient();
  const response = await client.goose.configExtensionsList_unstable({});
  return response.extensions as ExtensionEntry[];
}

export async function addExtension(
  name: string,
  extensionConfig: ExtensionConfig,
  enabled = false,
): Promise<void> {
  const client = await getClient();
  await client.goose.configExtensionsAdd_unstable({
    name,
    extensionConfig,
    enabled,
  });
}

export async function removeExtension(configKey: string): Promise<void> {
  const client = await getClient();
  await client.goose.configExtensionsRemove_unstable({ configKey });
}

export async function toggleExtension(
  configKey: string,
  enabled: boolean,
): Promise<void> {
  const client = await getClient();
  await client.goose.configExtensionsToggle_unstable({ configKey, enabled });
}
