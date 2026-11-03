import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { saveDiscrepancyLocally, markDiscrepancySynced } = vi.hoisted(() => ({
  saveDiscrepancyLocally: vi.fn(async () => {}),
  markDiscrepancySynced: vi.fn(async () => {}),
}));

vi.mock("@/stores/offline-db", () => ({
  saveDiscrepancyLocally,
  markDiscrepancySynced,
  saveCountLocally: vi.fn(),
  markCountSynced: vi.fn(),
  markCountsRejected: vi.fn(),
  isDefinitiveRejection: vi.fn(),
  isServiceWorkerOffline: vi.fn(),
  EVENT_NOT_ACTIVE_STATUS: 423,
}));
vi.mock("sonner", () => ({ toast: { info: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

import { reportUnknownSerials } from "../use-count-submission";

const disc = {
  itemCode: "X1",
  description: null,
  binNumber: "B1",
  binInternalId: null,
  unknownSerials: ["S1", "S2"],
};

beforeEach(() => {
  saveDiscrepancyLocally.mockClear();
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("reportUnknownSerials", () => {
  it("saves the offline discrepancy under the team's scope", async () => {
    await reportUnknownSerials(disc, { eventId: 4, teamId: 11 });
    expect(saveDiscrepancyLocally).toHaveBeenCalledTimes(1);
    const [record, scope] = saveDiscrepancyLocally.mock.calls[0] as unknown as [Record<string, unknown>, unknown];
    expect(scope).toEqual({ eventId: 4, teamId: 11 });
    expect(record).toMatchObject({ itemCode: "X1", unknownSerials: ["S1", "S2"] });
  });

  it("posts with the same clientId it saved locally", async () => {
    await reportUnknownSerials(disc, { eventId: 4, teamId: 11 });
    const [record] = saveDiscrepancyLocally.mock.calls[0] as unknown as [{ clientId: string }];
    const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string);
    expect(body.clientId).toBe(record.clientId);
    expect(markDiscrepancySynced).toHaveBeenCalledWith(record.clientId);
  });
});
