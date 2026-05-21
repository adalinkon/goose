import { getClient } from "@/shared/api/acpConnection";
import type {
  CustomProviderCreateResponse,
  CustomProviderDeleteResponse,
  CustomProviderReadResponse,
  CustomProviderUpdateResponse,
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
    const response = await client.GooseProvidersCatalogList(
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
    const response = await client.GooseProvidersCatalogTemplate({ providerId });
    return response.template;
  } catch (error) {
    normalizeCustomProviderApiError(error);
  }
}

export async function createCustomProvider(
  input: CustomProviderUpsertRequest,
): Promise<CustomProviderCreateResponse> {
  try {
    const client = await getProviderClient();
    return client.GooseProvidersCustomCreate(input);
  } catch (error) {
    normalizeCustomProviderApiError(error);
  }
}

export async function readCustomProvider(
  providerId: string,
): Promise<CustomProviderReadResponse> {
  try {
    const client = await getProviderClient();
    return client.GooseProvidersCustomRead({ providerId });
  } catch (error) {
    normalizeCustomProviderApiError(error);
  }
}

export async function updateCustomProvider(
  providerId: string,
  input: CustomProviderUpsertRequest,
): Promise<CustomProviderUpdateResponse> {
  try {
    const client = await getProviderClient();
    return client.GooseProvidersCustomUpdate({ ...input, providerId });
  } catch (error) {
    normalizeCustomProviderApiError(error);
  }
}

export async function deleteCustomProvider(
  providerId: string,
): Promise<CustomProviderDeleteResponse> {
  try {
    const client = await getProviderClient();
    return client.GooseProvidersCustomDelete({ providerId });
  } catch (error) {
    normalizeCustomProviderApiError(error);
  }
}
