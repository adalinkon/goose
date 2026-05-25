import { getClient } from "@/shared/api/acpConnection";
import type {
  CustomProviderCreateResponse_unstable,
  CustomProviderDeleteResponse_unstable,
  CustomProviderReadResponse_unstable,
  CustomProviderUpdateResponse_unstable,
  ProviderTemplateCatalogEntryDto,
  ProviderTemplateDto,
} from "@aaif/goose-sdk";
import type {
  CustomProviderFormat,
  CustomProviderUpsertRequest,
} from "../lib/customProviderTypes";

const CUSTOM_PROVIDER_UNSUPPORTED_MESSAGE =
  "Backend does not support custom provider APIs. Update goose backend and reconnect.";

function normalizeCustomProviderApiError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("Method not found")) {
    throw new Error(CUSTOM_PROVIDER_UNSUPPORTED_MESSAGE);
  }
  throw error;
}

async function getProviderClient() {
  const client = await getClient();
  return client.goose;
}

export async function listCustomProviderCatalog(
  format?: CustomProviderFormat,
): Promise<ProviderTemplateCatalogEntryDto[]> {
  try {
    const client = await getProviderClient();
    const response = await client.providersCatalogList_unstable(
      format ? { format } : {},
    );
    return response.providers;
  } catch (error) {
    normalizeCustomProviderApiError(error);
  }
}

export async function getCustomProviderTemplate(
  providerId: string,
): Promise<ProviderTemplateDto> {
  try {
    const client = await getProviderClient();
    const response = await client.providersCatalogTemplate_unstable({ providerId });
    return response.template;
  } catch (error) {
    normalizeCustomProviderApiError(error);
  }
}

export async function createCustomProvider(
  input: CustomProviderUpsertRequest,
): Promise<CustomProviderCreateResponse_unstable> {
  try {
    const client = await getProviderClient();
    return client.providersCustomCreate_unstable(input);
  } catch (error) {
    normalizeCustomProviderApiError(error);
  }
}

export async function readCustomProvider(
  providerId: string,
): Promise<CustomProviderReadResponse_unstable> {
  try {
    const client = await getProviderClient();
    return client.providersCustomRead_unstable({ providerId });
  } catch (error) {
    normalizeCustomProviderApiError(error);
  }
}

export async function updateCustomProvider(
  providerId: string,
  input: CustomProviderUpsertRequest,
): Promise<CustomProviderUpdateResponse_unstable> {
  try {
    const client = await getProviderClient();
    return client.providersCustomUpdate_unstable({ ...input, providerId });
  } catch (error) {
    normalizeCustomProviderApiError(error);
  }
}

export async function deleteCustomProvider(
  providerId: string,
): Promise<CustomProviderDeleteResponse_unstable> {
  try {
    const client = await getProviderClient();
    return client.providersCustomDelete_unstable({ providerId });
  } catch (error) {
    normalizeCustomProviderApiError(error);
  }
}
