import type {
  ProviderConfigChangeResponse_unstable,
  ProviderConfigFieldUpdate,
  ProviderConfigStatusDto,
} from "@aaif/goose-sdk";
import type { ProviderFieldValue } from "@/shared/types/providers";
import { getClient } from "@/shared/api/acpConnection";

export type ProviderStatus = ProviderConfigStatusDto;
export type ProviderFieldSaveInput = ProviderConfigFieldUpdate;

export async function getProviderConfig(
  providerId: string,
): Promise<ProviderFieldValue[]> {
  const client = await getClient();
  const response = await client.goose.providersConfigRead_unstable({ providerId });
  return response.fields;
}

export async function saveProviderConfig(
  providerId: string,
  fields: ProviderFieldSaveInput[],
): Promise<ProviderConfigChangeResponse_unstable> {
  const client = await getClient();
  return client.goose.providersConfigSave_unstable({ providerId, fields });
}

export async function authenticateProviderConfig(
  providerId: string,
): Promise<ProviderConfigChangeResponse_unstable> {
  const client = await getClient();
  return client.goose.providersConfigAuthenticate_unstable({ providerId });
}

export async function deleteProviderConfig(
  providerId: string,
): Promise<ProviderConfigChangeResponse_unstable> {
  const client = await getClient();
  return client.goose.providersConfigDelete_unstable({ providerId });
}

export async function checkAllProviderStatus(): Promise<ProviderStatus[]> {
  const client = await getClient();
  const response = await client.goose.providersConfigStatus_unstable({
    providerIds: [],
  });
  return response.statuses;
}
