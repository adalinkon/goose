import type {
  CustomProviderConfigDto,
  CustomProviderCreateRequest_unstable,
  CustomProviderCreateResponse_unstable,
  CustomProviderDeleteResponse_unstable,
  CustomProviderReadResponse_unstable,
  CustomProviderUpdateResponse_unstable,
  ProviderTemplateCatalogEntryDto,
  ProviderTemplateDto,
} from "@aaif/goose-sdk";

export type CustomProviderFormat = "openai" | "anthropic" | "ollama";

export type CustomProviderEngine =
  | "openai_compatible"
  | "anthropic_compatible"
  | "ollama_compatible";

export interface CustomProviderHeaderDraft {
  id: string;
  key: string;
  value: string;
}

export interface CustomProviderDraft {
  providerId?: string;
  editable: boolean;
  engine: string;
  displayName: string;
  apiUrl: string;
  basePath: string;
  apiKey: string;
  apiKeySet: boolean;
  modelsInput: string;
  models: string[];
  authInitiallyEnabled: boolean;
  requiresAuth: boolean;
  supportsStreaming: boolean;
  headers: CustomProviderHeaderDraft[];
  catalogProviderId?: string;
}

export type CustomProviderUpsertRequest = Omit<
  CustomProviderCreateRequest_unstable,
  "providerId"
> & {
  engine: CustomProviderEngine;
};

export type {
  CustomProviderConfigDto,
  CustomProviderCreateResponse_unstable,
  CustomProviderDeleteResponse_unstable,
  CustomProviderReadResponse_unstable,
  CustomProviderUpdateResponse_unstable,
  ProviderTemplateCatalogEntryDto,
  ProviderTemplateDto,
};
