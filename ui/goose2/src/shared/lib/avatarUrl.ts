import type { Avatar } from "@/shared/types/agents";

/**
 * Resolve an Avatar to a displayable image URL.
 * In pure-frontend mode, local avatars are expected to be returned as
 * backend-resolvable URLs from ACP APIs.
 */
export async function resolveAvatarSrc(
  avatar: Avatar | null | undefined,
): Promise<string | undefined> {
  if (!avatar) return undefined;
  if (avatar.type === "url") return avatar.value;
  if (avatar.type === "local") return avatar.value;
  return undefined;
}
