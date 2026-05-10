import type { DistroBundleInfo } from "@/shared/types/distro";

export async function getDistroBundle(): Promise<DistroBundleInfo> {
  return { present: false };
}
