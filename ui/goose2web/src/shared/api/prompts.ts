import { fetchJson } from "./gooseServeHttp";

export interface PromptTemplate {
  name: string;
  description: string;
  default_content: string;
  user_content?: string;
  is_customized: boolean;
}

interface PromptsListResponse {
  prompts: PromptTemplate[];
}

interface PromptContentResponse {
  name: string;
  content: string;
  default_content: string;
  is_customized: boolean;
}

export interface PromptContent {
  name: string;
  content: string;
  defaultContent: string;
  isCustomized: boolean;
}

export async function listPrompts(): Promise<PromptTemplate[]> {
  const response = await fetchJson<PromptsListResponse>("/config/prompts");
  return response.prompts;
}

export async function getPrompt(name: string): Promise<PromptContent> {
  const response = await fetchJson<PromptContentResponse>(
    `/config/prompts/${encodeURIComponent(name)}`,
  );

  return {
    name: response.name,
    content: response.content,
    defaultContent: response.default_content,
    isCustomized: response.is_customized,
  };
}

export async function savePrompt(name: string, content: string): Promise<void> {
  await fetchJson<string>(`/config/prompts/${encodeURIComponent(name)}`, {
    method: "PUT",
    body: { content },
  });
}

export async function resetPrompt(name: string): Promise<void> {
  await fetchJson<string>(`/config/prompts/${encodeURIComponent(name)}`, {
    method: "DELETE",
  });
}
