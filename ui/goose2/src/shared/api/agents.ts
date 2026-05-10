import { getClient } from "./acpConnection";
import { getActiveBackendServerName } from "./backendConfig";
import type {
  Persona,
  CreatePersonaRequest,
  UpdatePersonaRequest,
} from "@/shared/types/agents";

const BUILTIN_PERSONAS: Persona[] = [];

function personaStorageKey(): string {
  const scope = getActiveBackendServerName() ?? "default";
  return `goose:personas:${scope}`;
}

function readLocalPersonas(): Persona[] {
  try {
    const raw = localStorage.getItem(personaStorageKey());
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed as Persona[];
  } catch {
    return [];
  }
}

function writeLocalPersonas(personas: Persona[]): void {
  localStorage.setItem(personaStorageKey(), JSON.stringify(personas));
}

function nowIso(): string {
  return new Date().toISOString();
}

function withBuiltins(personas: Persona[]): Persona[] {
  return [...BUILTIN_PERSONAS, ...personas];
}

async function tryExtMethod<T>(
  method: string,
  params: Record<string, unknown>,
): Promise<T> {
  const client = await getClient();
  return (await client.extMethod(method, params)) as unknown as T;
}

export async function listPersonas(): Promise<Persona[]> {
  try {
    const response = await tryExtMethod<{ personas?: Persona[] }>(
      "_goose/personas/list",
      {},
    );
    return withBuiltins(response.personas ?? []);
  } catch {
    return withBuiltins(readLocalPersonas());
  }
}

export async function createPersona(
  request: CreatePersonaRequest,
): Promise<Persona> {
  try {
    const response = await tryExtMethod<{ persona: Persona }>(
      "_goose/personas/create",
      { request },
    );
    return response.persona;
  } catch {
    const persona: Persona = {
      id: crypto.randomUUID(),
      displayName: request.displayName,
      avatar: request.avatar ?? null,
      systemPrompt: request.systemPrompt,
      provider: request.provider,
      model: request.model,
      isBuiltin: false,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    writeLocalPersonas([persona, ...readLocalPersonas()]);
    return persona;
  }
}

export async function updatePersona(
  id: string,
  request: UpdatePersonaRequest,
): Promise<Persona> {
  try {
    const response = await tryExtMethod<{ persona: Persona }>(
      "_goose/personas/update",
      {
        id,
        request,
      },
    );
    return response.persona;
  } catch {
    const personas = readLocalPersonas();
    const index = personas.findIndex((persona) => persona.id === id);
    if (index < 0) {
      throw new Error(`Persona "${id}" not found`);
    }
    const updated: Persona = {
      ...personas[index],
      ...request,
      updatedAt: nowIso(),
    };
    personas[index] = updated;
    writeLocalPersonas(personas);
    return updated;
  }
}

export async function deletePersona(id: string): Promise<void> {
  try {
    await tryExtMethod("_goose/personas/delete", { id });
  } catch {
    const personas = readLocalPersonas().filter((persona) => persona.id !== id);
    writeLocalPersonas(personas);
  }
}

export async function refreshPersonas(): Promise<Persona[]> {
  try {
    const response = await tryExtMethod<{ personas?: Persona[] }>(
      "_goose/personas/refresh",
      {},
    );
    return withBuiltins(response.personas ?? []);
  } catch {
    return withBuiltins(readLocalPersonas());
  }
}

export interface ExportResult {
  json: string;
  suggestedFilename: string;
}

function slugify(name: string): string {
  const value = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return value || "persona";
}

export async function exportPersona(id: string): Promise<ExportResult> {
  try {
    return await tryExtMethod<ExportResult>("_goose/personas/export", { id });
  } catch {
    const persona = readLocalPersonas().find(
      (candidate) => candidate.id === id,
    );
    if (!persona) {
      throw new Error(`Persona "${id}" not found`);
    }
    return {
      json: JSON.stringify(
        {
          version: 1,
          displayName: persona.displayName,
          systemPrompt: persona.systemPrompt,
          avatar: persona.avatar ?? undefined,
          provider: persona.provider,
          model: persona.model,
        },
        null,
        2,
      ),
      suggestedFilename: `${slugify(persona.displayName)}.persona.json`,
    };
  }
}

export async function importPersonas(
  fileBytes: number[],
  fileName: string,
): Promise<Persona[]> {
  try {
    const response = await tryExtMethod<{ personas?: Persona[] }>(
      "_goose/personas/import",
      {
        fileBytes,
        fileName,
      },
    );
    return response.personas ?? [];
  } catch {
    const content = new TextDecoder().decode(new Uint8Array(fileBytes));
    const parsed = JSON.parse(content) as {
      displayName?: string;
      systemPrompt?: string;
      avatar?: Persona["avatar"];
      provider?: string;
      model?: string;
    };
    if (!parsed.displayName || !parsed.systemPrompt) {
      throw new Error("Invalid persona file");
    }
    const imported: Persona = {
      id: crypto.randomUUID(),
      displayName: parsed.displayName,
      avatar: parsed.avatar ?? null,
      systemPrompt: parsed.systemPrompt,
      provider: parsed.provider,
      model: parsed.model,
      isBuiltin: false,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    writeLocalPersonas([imported, ...readLocalPersonas()]);
    return [imported];
  }
}

export interface ImportFileReadResult {
  fileBytes: number[];
  fileName: string;
}

export async function readImportPersonaFile(
  sourcePath: string,
): Promise<ImportFileReadResult> {
  try {
    return await tryExtMethod<ImportFileReadResult>(
      "_goose/personas/read_import_file",
      { sourcePath },
    );
  } catch {
    throw new Error("Path-based persona import is not supported in web mode");
  }
}

export async function savePersonaAvatar(
  personaId: string,
  sourcePath: string,
): Promise<string> {
  try {
    const response = await tryExtMethod<{ filename: string }>(
      "_goose/personas/save_avatar",
      {
        personaId,
        sourcePath,
      },
    );
    return response.filename;
  } catch {
    throw new Error("Path-based avatar upload is not supported in web mode");
  }
}

export async function savePersonaAvatarBytes(
  personaId: string,
  bytes: number[],
  extension: string,
): Promise<string> {
  try {
    const response = await tryExtMethod<{ filename: string }>(
      "_goose/personas/save_avatar_bytes",
      {
        personaId,
        bytes,
        extension,
      },
    );
    return response.filename;
  } catch {
    const mimeType =
      extension === "svg" ? "image/svg+xml" : `image/${extension}`;
    const binary = String.fromCharCode(...bytes);
    const base64 = btoa(binary);
    return `data:${mimeType};base64,${base64}`;
  }
}

export async function getAvatarsDir(): Promise<string> {
  try {
    const response = await tryExtMethod<{ path: string }>(
      "_goose/personas/get_avatars_dir",
      {},
    );
    return response.path;
  } catch {
    return "";
  }
}
