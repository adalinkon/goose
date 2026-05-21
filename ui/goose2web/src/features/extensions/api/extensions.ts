import { getClient } from "@/shared/api/acpConnection";
import type { SessionExtensionInfo as GooseSessionExtensionInfo } from "@aaif/goose-sdk";
import type { ExtensionConfig, ExtensionEntry } from "../types";

export type SessionExtensionTool = NonNullable<
  GooseSessionExtensionInfo["tools"]
>[number];
export type SessionExtensionInfo = Omit<GooseSessionExtensionInfo, "tools"> & {
  tools: SessionExtensionTool[];
};

export async function listExtensions(): Promise<ExtensionEntry[]> {
  const client = await getClient();
  const response = await client.goose.GooseConfigExtensions({});
  return response.extensions as ExtensionEntry[];
}

export async function addExtension(
  name: string,
  extensionConfig: ExtensionConfig,
  enabled = false,
): Promise<void> {
  const client = await getClient();
  await client.goose.GooseConfigExtensionsAdd({
    name,
    extensionConfig,
    enabled,
  });
}

export async function removeExtension(configKey: string): Promise<void> {
  const client = await getClient();
  await client.goose.GooseConfigExtensionsRemove({ configKey });
}

export async function toggleExtension(
  configKey: string,
  enabled: boolean,
): Promise<void> {
  const client = await getClient();
  await client.goose.GooseConfigExtensionsToggle({ configKey, enabled });
}

export async function listSessionExtensions(
  sessionId: string,
): Promise<SessionExtensionInfo[]> {
  const client = await getClient();
  const response = await client.goose.GooseSessionExtensions({ sessionId });
  return response.extensions.map((extension) => ({
    ...extension,
    tools: extension.tools ?? [],
  }));
}
