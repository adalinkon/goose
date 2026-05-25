import type {
  DefaultsReadResponse_unstable,
  DefaultsSaveRequest_unstable,
  OnboardingImportApplyRequest_unstable,
  OnboardingImportApplyResponse_unstable,
  OnboardingImportCandidate,
} from "@aaif/goose-sdk";
import { getClient } from "@/shared/api/acpConnection";

export async function readDefaults(): Promise<DefaultsReadResponse_unstable> {
  const client = await getClient();
  return client.goose.defaultsRead_unstable({});
}

export async function saveDefaults(
  params: DefaultsSaveRequest_unstable,
): Promise<DefaultsReadResponse_unstable> {
  const client = await getClient();
  return client.goose.defaultsSave_unstable(params);
}

export async function scanOnboardingImports(): Promise<
  OnboardingImportCandidate[]
> {
  const client = await getClient();
  const response = await client.goose.onboardingImportScan_unstable({
    sources: [],
  });
  return response.candidates;
}

export async function applyOnboardingImports(
  params: OnboardingImportApplyRequest_unstable,
): Promise<OnboardingImportApplyResponse_unstable> {
  const client = await getClient();
  return client.goose.onboardingImportApply_unstable(params);
}
