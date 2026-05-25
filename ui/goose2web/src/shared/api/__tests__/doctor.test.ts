import { beforeEach, describe, expect, it, vi } from "vitest";
import { runDoctor, runDoctorFix } from "../doctor";

const mockFetchJson = vi.fn();

vi.mock("../gooseServeHttp", () => ({
  fetchJson: (...args: unknown[]) => mockFetchJson(...args),
}));

describe("doctor API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps doctor report", async () => {
    const report = { checks: [] };
    mockFetchJson.mockResolvedValue(report);

    await expect(runDoctor()).resolves.toEqual(report);
    expect(mockFetchJson).toHaveBeenCalledWith("/doctor/run", {
      method: "POST",
    });
  });

  it("invokes doctor fix", async () => {
    mockFetchJson.mockResolvedValue({});
    await runDoctorFix("git", "command");

    expect(mockFetchJson).toHaveBeenCalledWith("/doctor/fix", {
      method: "POST",
      body: { checkId: "git", fixType: "command" },
    });
  });
});
