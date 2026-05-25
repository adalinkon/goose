import type {
  DictationDownloadProgress,
  DictationProvider,
  DictationProviderStatus,
  DictationTranscribeResponse_unstable,
  WhisperModelStatus,
} from "@/shared/types/dictation";
import { getClient } from "./acpConnection";

export async function getDictationConfig(): Promise<
  Record<DictationProvider, DictationProviderStatus>
> {
  const client = await getClient();
  const response = await client.goose.dictationConfig_unstable({});
  return response.providers as Record<
    DictationProvider,
    DictationProviderStatus
  >;
}

export async function transcribeDictation(request: {
  audio: string;
  mimeType: string;
  provider: DictationProvider;
}): Promise<DictationTranscribeResponse_unstable> {
  const client = await getClient();
  return client.goose.dictationTranscribe_unstable({
    audio: request.audio,
    mimeType: request.mimeType,
    provider: request.provider,
  });
}

export async function saveDictationModelSelection(
  provider: DictationProvider,
  modelId: string,
): Promise<void> {
  const client = await getClient();
  await client.goose.dictationModelsSelect_unstable({ provider, modelId });
}

export async function saveDictationProviderSecret(
  provider: DictationProvider,
  value: string,
): Promise<void> {
  const client = await getClient();
  await client.goose.dictationSecretSave_unstable({ provider, value });
}

export async function deleteDictationProviderSecret(
  provider: DictationProvider,
): Promise<void> {
  const client = await getClient();
  await client.goose.dictationSecretDelete_unstable({ provider });
}

export async function listDictationLocalModels(): Promise<
  WhisperModelStatus[]
> {
  const client = await getClient();
  const response = await client.goose.dictationModelsList_unstable({});
  return response.models;
}

export async function downloadDictationLocalModel(
  modelId: string,
): Promise<void> {
  const client = await getClient();
  await client.goose.dictationModelsDownload_unstable({ modelId });
}

export async function getDictationLocalModelDownloadProgress(
  modelId: string,
): Promise<DictationDownloadProgress | null> {
  const client = await getClient();
  const response = await client.goose.dictationModelsDownloadProgress_unstable({
    modelId,
  });
  return response.progress ?? null;
}

export async function cancelDictationLocalModelDownload(
  modelId: string,
): Promise<void> {
  const client = await getClient();
  await client.goose.dictationModelsCancel_unstable({ modelId });
}

export async function deleteDictationLocalModel(
  modelId: string,
): Promise<void> {
  const client = await getClient();
  await client.goose.dictationModelsDelete_unstable({ modelId });
}
