import { getClient } from "@/shared/api/acpConnection";

type UnlistenFn = () => void;

export async function checkAgentInstalled(
  providerId: string,
): Promise<boolean> {
  const client = await getClient();
  const response = await client.extMethod(
    "_goose/providers/agent/check_installed",
    {
      providerId,
    },
  );
  return response.installed === true;
}

export async function checkAgentAuth(providerId: string): Promise<boolean> {
  const client = await getClient();
  const response = await client.extMethod("_goose/providers/agent/check_auth", {
    providerId,
  });
  return response.authenticated === true;
}

export async function installAgent(providerId: string): Promise<void> {
  const client = await getClient();
  await client.extMethod("_goose/providers/agent/install", { providerId });
}

export async function authenticateAgent(providerId: string): Promise<void> {
  const client = await getClient();
  await client.extMethod("_goose/providers/agent/authenticate", { providerId });
}

export async function onAgentSetupOutput(
  providerId: string,
  callback: (line: string) => void,
): Promise<UnlistenFn> {
  void providerId;
  void callback;
  return () => {};
}
