import type { SourceEntry } from "@aaif/goose-sdk";
import type {
  Persona,
  CreatePersonaRequest,
  UpdatePersonaRequest,
  Avatar,
} from "@/shared/types/agents";
import { getClient } from "./acpConnection";

const AGENT_SOURCE_TYPE = "agent" as const;

function decodeBytes(fileBytes: number[]): string {
  return new TextDecoder().decode(Uint8Array.from(fileBytes));
}

function isAvatar(value: unknown): value is Avatar {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { type?: unknown; value?: unknown };
  return candidate.type === "url" && typeof candidate.value === "string";
}

function toAvatar(value: unknown): Avatar | null {
  if (isAvatar(value)) return value;
  if (typeof value === "string") return { type: "url", value };
  return null;
}

function toStringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

function toPersona(source: SourceEntry): Persona {
  const properties = source.properties ?? {};
  const now = new Date().toISOString();

  return {
    id: source.path,
    displayName: source.name,
    avatar: toAvatar(properties.avatar) ?? undefined,
    systemPrompt: source.content,
    provider: toStringOrUndefined(properties.provider),
    model: toStringOrUndefined(properties.model),
    isBuiltin: false,
    isFromDisk: source.writable === false,
    writable: source.writable ?? true,
    createdAt: toStringOrUndefined(properties.createdAt) ?? now,
    updatedAt: toStringOrUndefined(properties.updatedAt) ?? now,
  };
}

function toSourceProperties(data: {
  avatar?: Avatar | null;
  provider?: string;
  model?: string;
  createdAt?: string;
  updatedAt?: string;
}): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  if (data.avatar) properties.avatar = data.avatar;
  if (data.provider) properties.provider = data.provider;
  if (data.model) properties.model = data.model;
  if (data.createdAt) properties.createdAt = data.createdAt;
  if (data.updatedAt) properties.updatedAt = data.updatedAt;
  return properties;
}

async function listAgentSources(): Promise<SourceEntry[]> {
  const client = await getClient();
  const response = await client.goose.GooseSourcesList({
    type: AGENT_SOURCE_TYPE,
  });
  return response.sources.filter((entry) => entry.type === AGENT_SOURCE_TYPE);
}

async function getAgentSourceByPath(path: string): Promise<SourceEntry> {
  const sources = await listAgentSources();
  const source = sources.find((entry) => entry.path === path);
  if (!source) {
    throw new Error(`Persona not found: ${path}`);
  }
  return source;
}

function normalizePersonaImportPayload(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  return [payload];
}

function normalizeLegacyPersonaPayload(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid persona import payload");
  }

  const candidate = payload as Record<string, unknown>;
  const hasSourceShape =
    typeof candidate.version === "number" &&
    typeof candidate.type === "string" &&
    typeof candidate.name === "string";
  if (hasSourceShape) {
    return JSON.stringify(candidate);
  }

  const displayName = toStringOrUndefined(candidate.displayName);
  const systemPrompt = toStringOrUndefined(candidate.systemPrompt);
  if (!displayName || !systemPrompt) {
    throw new Error("Invalid persona import payload");
  }

  const legacyExport = {
    version: 1,
    type: AGENT_SOURCE_TYPE,
    name: displayName,
    description: "",
    content: systemPrompt,
    properties: toSourceProperties({
      avatar: toAvatar(candidate.avatar),
      provider: toStringOrUndefined(candidate.provider),
      model: toStringOrUndefined(candidate.model),
      createdAt: toStringOrUndefined(candidate.createdAt),
      updatedAt: toStringOrUndefined(candidate.updatedAt),
    }),
  };

  return JSON.stringify(legacyExport);
}

export async function listPersonas(): Promise<Persona[]> {
  const sources = await listAgentSources();
  return sources.map(toPersona);
}

export async function createPersona(
  request: CreatePersonaRequest,
): Promise<Persona> {
  const client = await getClient();
  const now = new Date().toISOString();
  const response = await client.goose.GooseSourcesCreate({
    type: AGENT_SOURCE_TYPE,
    name: request.displayName,
    description: "",
    content: request.systemPrompt,
    global: true,
    properties: toSourceProperties({
      avatar: request.avatar,
      provider: request.provider,
      model: request.model,
      createdAt: now,
      updatedAt: now,
    }),
  });
  return toPersona(response.source);
}

export async function updatePersona(
  id: string,
  request: UpdatePersonaRequest,
): Promise<Persona> {
  const source = await getAgentSourceByPath(id);
  const properties = source.properties ?? {};
  const response = await (await getClient()).goose.GooseSourcesUpdate({
    type: AGENT_SOURCE_TYPE,
    path: source.path,
    name: request.displayName ?? source.name,
    description: source.description,
    content: request.systemPrompt ?? source.content,
    properties: {
      ...properties,
      ...toSourceProperties({
        avatar:
          request.avatar === undefined
            ? toAvatar(properties.avatar)
            : request.avatar,
        provider:
          request.provider === undefined
            ? toStringOrUndefined(properties.provider)
            : request.provider,
        model:
          request.model === undefined
            ? toStringOrUndefined(properties.model)
            : request.model,
        createdAt: toStringOrUndefined(properties.createdAt),
        updatedAt: new Date().toISOString(),
      }),
    },
  });
  return toPersona(response.source);
}

export async function deletePersona(id: string): Promise<void> {
  await (await getClient()).goose.GooseSourcesDelete({
    type: AGENT_SOURCE_TYPE,
    path: id,
  });
}

export async function refreshPersonas(): Promise<Persona[]> {
  return listPersonas();
}

export interface ExportResult {
  json: string;
  suggestedFilename: string;
}

export async function exportPersona(id: string): Promise<ExportResult> {
  const response = await (await getClient()).goose.GooseSourcesExport({
    type: AGENT_SOURCE_TYPE,
    path: id,
  });
  return {
    json: response.json,
    suggestedFilename: response.filename,
  };
}

export async function importPersonas(
  fileBytes: number[],
  _fileName: string,
): Promise<Persona[]> {
  const decoded = decodeBytes(fileBytes);
  const parsed = JSON.parse(decoded) as unknown;
  const payloads = normalizePersonaImportPayload(parsed);
  const client = await getClient();
  const importedSources: SourceEntry[] = [];

  for (const payload of payloads) {
    const response = await client.goose.GooseSourcesImport({
      data: normalizeLegacyPersonaPayload(payload),
      global: true,
    });
    importedSources.push(...response.sources);
  }

  return importedSources
    .filter((source) => source.type === AGENT_SOURCE_TYPE)
    .map(toPersona);
}

export interface ImportFileReadResult {
  fileBytes: number[];
  fileName: string;
}

export async function readImportPersonaFile(
  _sourcePath: string,
): Promise<ImportFileReadResult> {
  const file = await new Promise<File>((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.onchange = () => {
      const selected = input.files?.[0];
      if (!selected) {
        reject(new Error("No file selected"));
        return;
      }
      resolve(selected);
    };
    input.click();
  });

  const bytes = new Uint8Array(await file.arrayBuffer());
  return {
    fileBytes: Array.from(bytes),
    fileName: file.name,
  };
}

export async function savePersonaAvatar(
  _personaId: string,
  _sourcePath: string,
): Promise<string> {
  throw new Error(
    "Avatar file-path upload is not supported via ACP. Use savePersonaAvatarBytes instead.",
  );
}

export async function savePersonaAvatarBytes(
  _personaId: string,
  bytes: number[],
  extension: string,
): Promise<string> {
  const mimeExtension = extension.toLowerCase().replace(/^\./, "");
  const mimeType = mimeExtension === "jpg" ? "jpeg" : mimeExtension || "png";
  const binary = Uint8Array.from(bytes);
  let base64: string;
  if (typeof Buffer !== "undefined") {
    base64 = Buffer.from(binary).toString("base64");
  } else {
    let binaryString = "";
    for (const byte of binary) binaryString += String.fromCharCode(byte);
    base64 = btoa(binaryString);
  }
  return `data:image/${mimeType};base64,${base64}`;
}
