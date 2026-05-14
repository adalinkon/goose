import type { DistroBundleInfo } from "@/shared/types/distro";
import { fetchJson } from "./gooseServeHttp";

export async function getDistroBundle(): Promise<DistroBundleInfo> {
  return fetchJson<DistroBundleInfo>("/doctor/distro");
}
