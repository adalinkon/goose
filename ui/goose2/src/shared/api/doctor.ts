import { getClient } from "./acpConnection";

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
  try {
    const client = await getClient();
    const response = await client.extMethod("_goose/doctor/run", {});
    return response as unknown as DoctorReport;
  } catch {
    return { checks: [] };
  }
}

export async function runDoctorFix(
  checkId: string,
  fixType: FixType,
): Promise<void> {
  const client = await getClient();
  await client.extMethod("_goose/doctor/fix", { checkId, fixType });
}
