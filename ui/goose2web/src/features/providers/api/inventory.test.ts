import type { ProviderInventoryEntryDto } from "@aaif/goose-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { backgroundRefreshInventory } from "./inventory";

const mockClient = vi.hoisted(() => ({
  providersList_unstable: vi.fn(),
  providersInventoryRefresh_unstable: vi.fn(),
}));

vi.mock("@/shared/api/acpConnection", () => ({
  getClient: vi.fn(async () => ({
    goose: mockClient,
  })),
}));

function providerEntry(
  overrides: Partial<ProviderInventoryEntryDto>,
): ProviderInventoryEntryDto {
  return {
    providerId: "openai",
    providerName: "OpenAI",
    description: "",
    defaultModel: "",
    configured: false,
    providerType: "Preferred",
    category: "model",
    configKeys: [],
    setupSteps: [],
    supportsRefresh: false,
    refreshing: false,
    models: [],
    stale: false,
    ...overrides,
  };
}

describe("backgroundRefreshInventory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("merges fetched inventory before returning when no providers are configured", async () => {
    const entries = [
      providerEntry({ providerId: "openai", providerName: "OpenAI" }),
    ];
    const inventoryStore = { mergeEntries: vi.fn() };
    mockClient.providersList_unstable.mockResolvedValue({ entries });

    await backgroundRefreshInventory(inventoryStore);

    expect(inventoryStore.mergeEntries).toHaveBeenCalledWith(entries);
    expect(mockClient.providersInventoryRefresh_unstable).not.toHaveBeenCalled();
  });

  it("merges fetched inventory before returning when no refresh starts", async () => {
    const entries = [
      providerEntry({
        providerId: "openai",
        providerName: "OpenAI",
        configured: true,
      }),
    ];
    const inventoryStore = { mergeEntries: vi.fn() };
    mockClient.providersList_unstable.mockResolvedValue({ entries });
    mockClient.providersInventoryRefresh_unstable.mockResolvedValue({
      started: [],
    });

    await backgroundRefreshInventory(inventoryStore);

    expect(inventoryStore.mergeEntries).toHaveBeenCalledWith(entries);
    expect(mockClient.providersInventoryRefresh_unstable).toHaveBeenCalledWith({
      providerIds: ["openai"],
    });
  });

  it("does not re-merge entries supplied by a caller that already stored them", async () => {
    const entries = [
      providerEntry({
        providerId: "openai",
        providerName: "OpenAI",
        configured: true,
      }),
    ];
    const inventoryStore = { mergeEntries: vi.fn() };
    mockClient.providersInventoryRefresh_unstable.mockResolvedValue({
      started: [],
    });

    await backgroundRefreshInventory(inventoryStore, entries);

    expect(mockClient.providersList_unstable).not.toHaveBeenCalled();
    expect(inventoryStore.mergeEntries).not.toHaveBeenCalled();
    expect(mockClient.providersInventoryRefresh_unstable).toHaveBeenCalledWith({
      providerIds: ["openai"],
    });
  });
});
