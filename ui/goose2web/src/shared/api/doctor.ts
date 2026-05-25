import { fetchJson } from "./gooseServeHttp";

export type FixType = "command" | "bridge";

export interface DoctorCheck {
  id: string;
  label: string;
  status: "pass" | "warn" | "fail";
  message: string;
  fixUrl: string | null;
  fixCommand: string | null;
  fixType: FixType | null;
  path: string | null;
  bridgePath: string | null;
  rawOutput: string | null;
}

export interface DoctorReport {
  checks: DoctorCheck[];
}

export async function runDoctor(): Promise<DoctorReport> {
  return fetchJson<DoctorReport>("/doctor/run", { method: "POST" });
}

export async function runDoctorFix(
  checkId: string,
  fixType: FixType,
): Promise<void> {
  await fetchJson("/doctor/fix", {
    method: "POST",
    body: { checkId, fixType },
  });
}
