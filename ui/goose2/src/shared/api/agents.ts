import type {
  Persona,
  CreatePersonaRequest,
  UpdatePersonaRequest,
} from "@/shared/types/agents";
import { fetchJson } from "./gooseServeHttp";

export async function listPersonas(): Promise<Persona[]> {
  return fetchJson<Persona[]>("/personas");
}

export async function createPersona(
  request: CreatePersonaRequest,
): Promise<Persona> {
  return fetchJson<Persona>("/personas", {
    method: "POST",
    body: request,
  });
}

export async function updatePersona(
  id: string,
  request: UpdatePersonaRequest,
): Promise<Persona> {
  return fetchJson<Persona>(`/personas/${id}`, {
    method: "PUT",
    body: request,
  });
}

export async function deletePersona(id: string): Promise<void> {
  await fetchJson(`/personas/${id}`, { method: "DELETE" });
}

export async function refreshPersonas(): Promise<Persona[]> {
  return fetchJson<Persona[]>("/personas/refresh", { method: "POST" });
}

export interface ExportResult {
  json: string;
  suggestedFilename: string;
}

export async function exportPersona(id: string): Promise<ExportResult> {
  return fetchJson<ExportResult>(`/personas/${id}/export`);
}

export async function importPersonas(
  fileBytes: number[],
  fileName: string,
): Promise<Persona[]> {
  return fetchJson<Persona[]>("/personas/import", {
    method: "POST",
    body: { fileBytes, fileName },
  });
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
  personaId: string,
  sourcePath: string,
): Promise<string> {
  const response = await fetchJson<{ filename: string }>(
    "/personas/avatar/save-path",
    {
      method: "POST",
      body: { personaId, sourcePath },
    },
  );
  return response.filename;
}

export async function savePersonaAvatarBytes(
  personaId: string,
  bytes: number[],
  extension: string,
): Promise<string> {
  const response = await fetchJson<{ filename: string }>(
    "/personas/avatar/save-bytes",
    {
      method: "POST",
      body: { personaId, bytes, extension },
    },
  );
  return response.filename;
}
