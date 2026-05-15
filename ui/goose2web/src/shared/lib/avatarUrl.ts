import { getGooseServeHostInfo } from "@/shared/api/gooseServeHost";
import type { Avatar } from "@/shared/types/agents";

let cachedBaseUrl: string | null = null;

async function ensureBaseUrl(): Promise<string> {
  if (!cachedBaseUrl) {
    const { httpBaseUrl } = await getGooseServeHostInfo();
    cachedBaseUrl = httpBaseUrl;
  }
  return cachedBaseUrl;
}

/**
 * Resolve an Avatar to a displayable image URL.
 * Lazily fetches the avatars directory on first call for a local avatar.
 */
export async function resolveAvatarSrc(
  avatar: Avatar | null | undefined,
): Promise<string | undefined> {
  if (!avatar) return undefined;
  if (avatar.type === "url") return avatar.value;
  if (avatar.type === "local") {
    const baseUrl = await ensureBaseUrl();
    return `${baseUrl}/personas/avatar/${encodeURIComponent(avatar.value)}`;
  }
  return undefined;
}
