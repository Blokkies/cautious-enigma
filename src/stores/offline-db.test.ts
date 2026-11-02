import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SYNCED_DONE,
  SYNCED_PENDING,
  SYNCED_REJECTED,
  clearOfflineData,
  clearSessionOfflineData,
  getPendingSyncCount,
  getUnsyncedCounts,
  isDefinitiveRejection,
  isServiceWorkerOffline,
  markCountsRejected,
  offlineDb,
  saveCountLocally,
  saveDiscrepancyLocally,
  syncToServer,
  type OfflineCount,
  type OfflineItem,
} from "./offline-db";

const SCOPE = { eventId: 1, teamId: 10 };
const OTHER = { eventId: 1, teamId: 99 };

function count(clientId: string, overrides: Partial<OfflineCount> = {}): OfflineCount {
  return {
    clientId,
    itemId: 1,
    countedQty: 1,
    isMatch: true,
    countedAt: "2026-01-01T10:00:00.000Z",
    synced: SYNCED_PENDING,
    ...SCOPE,
    ...overrides,
  };
}

function item(id: number, overrides: Partial<OfflineItem> = {}): OfflineItem {
  return {
    id,
    itemCode: `I${id}`,
    description: null,
    brand: null,
    category: null,
    binNumber: "B1",
    binInternalId: null,
    warehouse: null,
    division: null,
    onHand: 5,
    avgCost: 1,
    totalValue: 5,
    stockStatus: null,
    serialNumber: null,
    isSerialized: false,
    countId: null,
    countedQty: null,
    variance: null,
    isMatch: null,
    comment: "server comment",
    countedAt: null,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function syncedState(clientId: string) {
  return (await offlineDb.counts.get(clientId))?.synced;
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(async () => {
  await clearOfflineData();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function sentBody(callIndex = 0) {
  return JSON.parse(String(fetchMock.mock.calls[callIndex][1]!.body));
}

describe("isDefinitiveRejection", () => {
  it.each([400, 403, 404, 409, 410, 422, 499])("%i is a definitive rejection", (s) => {
    expect(isDefinitiveRejection(s)).toBe(true);
  });

  it.each([401, 408, 429, 500, 502, 503, 504, 200, 204, 302, 0])("%i is retryable / not a rejection", (s) => {
    expect(isDefinitiveRejection(s)).toBe(false);
  });
});

describe("isServiceWorkerOffline", () => {
  it("detects the service worker's synthesized offline response", () => {
    expect(isServiceWorkerOffline(new Response(null, { status: 503, headers: { "X-SW-Offline": "1" } }))).toBe(true);
    expect(isServiceWorkerOffline(new Response(null, { status: 503 }))).toBe(false);
  });
});

describe("getUnsyncedCounts / getPendingSyncCount scope filtering", () => {
  beforeEach(async () => {
    await offlineDb.counts.bulkPut([
      count("c-late", { countedAt: "2026-01-01T12:00:00.000Z" }),
      count("c-early", { countedAt: "2026-01-01T08:00:00.000Z" }),
      count("c-other", { ...OTHER }),
      count("c-legacy", { eventId: undefined, teamId: undefined }),
      count("c-done", { synced: SYNCED_DONE }),
      count("c-rejected", { synced: SYNCED_REJECTED }),
    ]);
  });

  it("returns only pending counts in scope (plus legacy unscoped), oldest first", async () => {
    const rows = await getUnsyncedCounts(SCOPE);
    expect(rows.map((r) => r.clientId)).toEqual(["c-early", "c-legacy", "c-late"]);
  });

  it("returns every pending count when no scope is given", async () => {
    const rows = await getUnsyncedCounts(null);
    expect(rows.map((r) => r.clientId).sort()).toEqual(["c-early", "c-late", "c-legacy", "c-other"]);
  });

  it("requires both eventId and teamId to match", async () => {
    await offlineDb.counts.put(count("c-half", { eventId: 1, teamId: undefined }));
    const rows = await getUnsyncedCounts(SCOPE);
    expect(rows.map((r) => r.clientId)).not.toContain("c-half");
  });

  it("counts pending counts in scope plus ALL pending discrepancies", async () => {
    await saveDiscrepancyLocally({
      clientId: "d1",
      itemCode: "X",
      description: null,
      binNumber: null,
      binInternalId: null,
      unknownSerials: ["S"],
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(await getPendingSyncCount(SCOPE)).toBe(3 + 1);
    expect(await getPendingSyncCount()).toBe(4 + 1);
  });
});

describe("saveCountLocally", () => {
  it("stores a pending count and updates the local item", async () => {
    await offlineDb.items.put(item(1, { onHand: 5 }));
    await saveCountLocally({ clientId: "c1", itemId: 1, countedQty: 3, isMatch: false, countedAt: "t1", ...SCOPE });

    expect(await syncedState("c1")).toBe(SYNCED_PENDING);
    const local = await offlineDb.items.get(1);
    expect(local).toMatchObject({ countId: -1, countedQty: 3, variance: -2, isMatch: false, countedAt: "t1" });
    expect(local?.comment).toBe("server comment"); // undefined comment keeps the existing one
  });

  it("clears the comment when given an empty string or null", async () => {
    await offlineDb.items.put(item(1));
    await saveCountLocally({ clientId: "c1", itemId: 1, countedQty: 5, isMatch: true, comment: "", countedAt: "t" });
    expect((await offlineDb.items.get(1))?.comment).toBeNull();
  });

  it("computes variance against onHand 0 when the item is not cached", async () => {
    await saveCountLocally({ clientId: "c1", itemId: 42, countedQty: 2, isMatch: false, countedAt: "t" });
    expect(await offlineDb.counts.get("c1")).toBeDefined();
    expect(await offlineDb.items.get(42)).toBeUndefined(); // update() on a missing row is a no-op
  });
});

describe("markCountsRejected", () => {
  it("marks counts rejected with a default reason and is a no-op for an empty list", async () => {
    await offlineDb.counts.put(count("c1"));
    await markCountsRejected([]);
    expect(await syncedState("c1")).toBe(SYNCED_PENDING);
    await markCountsRejected(["c1"]);
    expect(await offlineDb.counts.get("c1")).toMatchObject({ synced: SYNCED_REJECTED, syncError: "Rejected by server" });
  });
});

describe("syncToServer", () => {
  it("does not call the server when nothing is pending", async () => {
    expect(await syncToServer(SCOPE)).toEqual({ synced: 0, failed: 0, authExpired: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("collapses normal counts to the latest per item by countedAt and marks superseded ones synced", async () => {
    await offlineDb.counts.bulkPut([
      count("a-new", { itemId: 1, countedQty: 9, countedAt: "2026-01-01T12:00:00.000Z" }),
      count("a-old", { itemId: 1, countedQty: 4, countedAt: "2026-01-01T09:00:00.000Z" }),
      count("b-only", { itemId: 2, countedQty: 1, countedAt: "2026-01-01T10:00:00.000Z" }),
    ]);
    fetchMock.mockResolvedValue(jsonResponse({ results: [{ success: true }, { success: true }] }));

    const result = await syncToServer(SCOPE);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/team/count");
    expect(fetchMock.mock.calls[0][1]?.method).toBe("PUT");
    const body = sentBody();
    // Map insertion order: first-seen item first (items sorted oldest-first)
    expect(body.counts.map((c: { clientId: string }) => c.clientId)).toEqual(["a-new", "b-only"]);
    expect(body.counts[0]).toEqual({
      itemId: 1,
      countedQty: 9,
      isMatch: true,
      clientId: "a-new",
      countedAt: "2026-01-01T12:00:00.000Z",
    });
    expect(body.verificationCounts).toEqual([]);

    expect(await syncedState("a-old")).toBe(SYNCED_DONE); // superseded, never sent
    expect(await syncedState("a-new")).toBe(SYNCED_DONE);
    expect(await syncedState("b-only")).toBe(SYNCED_DONE);
    // superseded entries are not counted as synced
    expect(result).toEqual({ synced: 2, failed: 0, authExpired: false });
  });

  it("breaks countedAt ties by clientId order, not insertion order", async () => {
    // Pending rows come back from the 'synced' index in primary-key (clientId) order and
    // the sort is stable, so with identical timestamps the larger clientId wins.
    await offlineDb.counts.bulkPut([
      count("zzz", { countedQty: 1, countedAt: "2026-01-01T10:00:00.000Z" }),
      count("aaa", { countedQty: 2, countedAt: "2026-01-01T10:00:00.000Z" }),
    ]);
    fetchMock.mockResolvedValue(jsonResponse({ results: [{ success: true }] }));
    await syncToServer(SCOPE);
    expect(sentBody().counts.map((c: { clientId: string }) => c.clientId)).toEqual(["zzz"]);
  });

  it("sends verification counts separately and never collapses them", async () => {
    await offlineDb.counts.bulkPut([
      count("v1", { itemId: 1, verificationId: 5, countedAt: "2026-01-01T08:00:00.000Z" }),
      count("v2", { itemId: 1, verificationId: 5, countedAt: "2026-01-01T09:00:00.000Z", comment: "re" }),
      count("n1", { itemId: 1, countedAt: "2026-01-01T07:00:00.000Z" }),
    ]);
    fetchMock.mockResolvedValue(
      jsonResponse({ results: [{ success: true }], verificationResults: [{ success: true }, { deduplicated: true }] })
    );

    const result = await syncToServer(SCOPE);
    const body = sentBody();
    expect(body.counts.map((c: { clientId: string }) => c.clientId)).toEqual(["n1"]);
    expect(body.verificationCounts).toEqual([
      { verificationId: 5, itemId: 1, countedQty: 1, clientId: "v1", countedAt: "2026-01-01T08:00:00.000Z" },
      { verificationId: 5, itemId: 1, countedQty: 1, comment: "re", clientId: "v2", countedAt: "2026-01-01T09:00:00.000Z" },
    ]);
    expect(result).toEqual({ synced: 3, failed: 0, authExpired: false });
  });

  it("marks per-item errors rejected, leaves unanswered items pending", async () => {
    await offlineDb.counts.bulkPut([
      count("ok", { itemId: 1, countedAt: "t1" }),
      count("bad", { itemId: 2, countedAt: "t2" }),
      count("silent", { itemId: 3, countedAt: "t3" }),
      count("missing", { itemId: 4, countedAt: "t4" }),
    ]);
    fetchMock.mockResolvedValue(
      jsonResponse({ results: [{ success: true }, { error: "Item reviewed" }, { success: false }] })
    );

    const result = await syncToServer(SCOPE);
    expect(await syncedState("ok")).toBe(SYNCED_DONE);
    expect(await offlineDb.counts.get("bad")).toMatchObject({ synced: SYNCED_REJECTED, syncError: "Item reviewed" });
    expect(await syncedState("silent")).toBe(SYNCED_PENDING);
    expect(await syncedState("missing")).toBe(SYNCED_PENDING);
    expect(result).toEqual({ synced: 1, failed: 3, authExpired: false });
  });

  it("stops on 401 with authExpired and leaves everything pending (discrepancies not attempted)", async () => {
    await offlineDb.counts.put(count("c1"));
    await saveDiscrepancyLocally({
      clientId: "d1", itemCode: "X", description: null, binNumber: null, binInternalId: null,
      unknownSerials: ["S"], createdAt: "t",
    });
    fetchMock.mockResolvedValue(jsonResponse({ error: "expired" }, 401));

    expect(await syncToServer(SCOPE)).toEqual({ synced: 0, failed: 0, authExpired: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await syncedState("c1")).toBe(SYNCED_PENDING);
    expect((await offlineDb.serialDiscrepancies.get("d1"))?.synced).toBe(0);
  });

  it.each([500, 503])("counts a %i as failed and keeps counts pending for retry", async (status) => {
    await offlineDb.counts.bulkPut([count("c1", { itemId: 1 }), count("c2", { itemId: 2 })]);
    fetchMock.mockResolvedValue(jsonResponse({}, status));
    expect(await syncToServer(SCOPE)).toEqual({ synced: 0, failed: 2, authExpired: false });
    expect(await syncedState("c1")).toBe(SYNCED_PENDING);
  });

  it("keeps counts pending even on a whole-batch 4xx (isDefinitiveRejection is not applied here)", async () => {
    // NOTE: unlike the online count path in the team count page, a batch-level 400/403
    // is retried on every sync rather than marked rejected.
    await offlineDb.counts.put(count("c1"));
    fetchMock.mockResolvedValue(jsonResponse({ error: "bad" }, 400));
    expect(await syncToServer(SCOPE)).toEqual({ synced: 0, failed: 1, authExpired: false });
    expect(await syncedState("c1")).toBe(SYNCED_PENDING);
  });

  it("counts network errors as failed", async () => {
    await offlineDb.counts.put(count("c1"));
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    expect(await syncToServer(SCOPE)).toEqual({ synced: 0, failed: 1, authExpired: false });
    expect(await syncedState("c1")).toBe(SYNCED_PENDING);
  });

  it("only sends counts in scope", async () => {
    await offlineDb.counts.bulkPut([count("mine", { itemId: 1 }), count("theirs", { itemId: 2, ...OTHER })]);
    fetchMock.mockResolvedValue(jsonResponse({ results: [{ success: true }] }));
    await syncToServer(SCOPE);
    expect(sentBody().counts.map((c: { clientId: string }) => c.clientId)).toEqual(["mine"]);
    expect(await syncedState("theirs")).toBe(SYNCED_PENDING);
  });

  it("syncs serial discrepancies in one batch POST after counts", async () => {
    for (const id of ["d1", "d2"]) {
      await saveDiscrepancyLocally({
        clientId: id, itemCode: "X", description: "Desc", binNumber: "B", binInternalId: "9",
        unknownSerials: ["S1", "S2"], createdAt: "t",
      });
    }
    fetchMock.mockResolvedValue(jsonResponse({ results: [{ success: true }, { success: false }] }));

    const result = await syncToServer(SCOPE);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/team/serial-discrepancies");
    expect(sentBody().batch[0]).toEqual({
      itemCode: "X", description: "Desc", binNumber: "B", binInternalId: "9", unknownSerials: ["S1", "S2"], clientId: "d1",
    });
    expect((await offlineDb.serialDiscrepancies.get("d1"))?.synced).toBe(1);
    expect((await offlineDb.serialDiscrepancies.get("d2"))?.synced).toBe(0);
    expect(result).toEqual({ synced: 1, failed: 1, authExpired: false });
  });
});

describe("clearSessionOfflineData", () => {
  it("removes this session's synced/rejected counts but never pending ones or other sessions'", async () => {
    await offlineDb.counts.bulkPut([
      count("pending"),
      count("done", { synced: SYNCED_DONE }),
      count("rejected", { synced: SYNCED_REJECTED }),
      count("other-done", { ...OTHER, synced: SYNCED_DONE }),
      count("legacy-done", { eventId: undefined, teamId: undefined, synced: SYNCED_DONE }),
    ]);
    await offlineDb.items.put(item(1));
    await offlineDb.meta.put({ key: "lastSync", value: "x" });

    await clearSessionOfflineData(SCOPE);

    const remaining = (await offlineDb.counts.toArray()).map((c) => c.clientId).sort();
    expect(remaining).toEqual(["other-done", "pending"]);
    expect(await offlineDb.items.count()).toBe(0);
    expect(await offlineDb.meta.count()).toBe(0);
  });
});
