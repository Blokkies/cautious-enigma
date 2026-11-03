import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SYNCED_DONE,
  SYNCED_PENDING,
  SYNCED_REJECTED,
  cacheTeamItems,
  clearOfflineData,
  collapseQueuedCounts,
  dismissRejectedRecords,
  getCachedItemsScope,
  getLocalItems,
  getRejectedRecords,
  markCountSynced,
  offlineDb,
  overlayPendingCounts,
  preloadItems,
  retryRejectedRecords,
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
    id, itemCode: `I${id}`, description: null, brand: null, category: null, binNumber: "B1",
    binInternalId: null, warehouse: null, division: null, onHand: 5, avgCost: 1, totalValue: 5,
    stockStatus: null, serialNumber: null, isSerialized: false, countId: null, countedQty: null,
    variance: null, isMatch: null, comment: null, countedAt: null,
    ...overrides,
  };
}

function disc(clientId: string) {
  return {
    clientId, itemCode: "X", description: null, binNumber: null, binInternalId: null,
    unknownSerials: ["S"], createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const syncedState = async (clientId: string) => (await offlineDb.counts.get(clientId))?.synced;
const fetchMock = vi.fn<typeof fetch>();
const sentBody = (i = 0) => JSON.parse(String(fetchMock.mock.calls[i][1]!.body));

beforeEach(async () => {
  await clearOfflineData();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("event-not-active (423) and other retryable batch failures", () => {
  it.each([423, 413, 500])("keeps the whole batch pending on %i so it syncs after reactivation", async (status) => {
    await offlineDb.counts.bulkPut([count("c1", { itemId: 1 }), count("v1", { itemId: 2, verificationId: 5 })]);
    await saveDiscrepancyLocally(disc("d1"), SCOPE);
    fetchMock.mockImplementation(async () =>
      jsonResponse({ error: "This stocktake has not been activated yet.", code: "EVENT_NOT_ACTIVE" }, status)
    );

    expect(await syncToServer(SCOPE)).toEqual({ synced: 0, failed: 3, authExpired: false });
    expect(await syncedState("c1")).toBe(SYNCED_PENDING);
    expect(await syncedState("v1")).toBe(SYNCED_PENDING);
    expect((await offlineDb.serialDiscrepancies.get("d1"))?.synced).toBe(SYNCED_PENDING);

    // Event reactivated: the same records go through
    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ results: [{ success: true }], verificationResults: [{ success: true }] }))
      .mockResolvedValueOnce(jsonResponse({ results: [{ success: true }] }));
    expect(await syncToServer(SCOPE)).toEqual({ synced: 3, failed: 0, authExpired: false });
    expect(await syncedState("c1")).toBe(SYNCED_DONE);
  });
});

describe("collapsing queued counts keeps comments", () => {
  it("carries the latest earlier comment onto a kept count that has none, and persists it", async () => {
    await offlineDb.counts.bulkPut([
      count("a", { comment: "first", seq: 1 }),
      count("b", { comment: "damaged box", seq: 2 }),
      count("c", { countedQty: 7, seq: 3 }),
    ]);
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 503)); // first attempt fails
    await syncToServer(SCOPE);
    expect(sentBody().counts).toEqual([
      expect.objectContaining({ clientId: "c", countedQty: 7, comment: "damaged box" }),
    ]);
    expect(await syncedState("b")).toBe(SYNCED_DONE); // superseded

    // The retry still carries the comment although the older rows left the queue
    fetchMock.mockResolvedValueOnce(jsonResponse({ results: [{ success: true }] }));
    await syncToServer(SCOPE);
    expect(sentBody(1).counts[0]).toMatchObject({ clientId: "c", comment: "damaged box" });
  });

  it("carries an explicit clear, and never overrides the kept count's own comment", () => {
    const cleared = collapseQueuedCounts([
      count("a", { comment: "x", seq: 1 }),
      count("b", { comment: "", seq: 2 }),
      count("c", { seq: 3 }),
    ]);
    expect(cleared.kept[0]).toMatchObject({ clientId: "c", comment: null });

    const own = collapseQueuedCounts([count("a", { comment: "x", seq: 1 }), count("b", { comment: "mine", seq: 2 })]);
    expect(own.kept[0].comment).toBe("mine");
    expect(own.carriedComments.size).toBe(0);
    expect(own.supersededIds).toEqual(["a"]);
  });

  it("saveCountLocally inherits a pending earlier comment so the immediate POST sends it", async () => {
    await saveCountLocally({ clientId: "a", itemId: 1, countedQty: 1, isMatch: false, comment: "note", countedAt: "t1", ...SCOPE });
    const sent = await saveCountLocally({ clientId: "b", itemId: 1, countedQty: 2, isMatch: false, countedAt: "t2", ...SCOPE });
    expect(sent).toBe("note");
    expect((await offlineDb.counts.get("b"))?.comment).toBe("note");
    // Another session's pending comment is not inherited
    await saveCountLocally({ clientId: "z", itemId: 2, countedQty: 1, isMatch: false, comment: "theirs", countedAt: "t1", ...OTHER });
    expect(
      await saveCountLocally({ clientId: "y", itemId: 2, countedQty: 1, isMatch: false, countedAt: "t2", ...SCOPE })
    ).toBeUndefined();
  });

  it("markCountSynced supersedes earlier pending counts for the same item", async () => {
    await saveCountLocally({ clientId: "old", itemId: 1, countedQty: 1, isMatch: false, countedAt: "t1", ...SCOPE });
    await saveCountLocally({ clientId: "other-item", itemId: 2, countedQty: 1, isMatch: false, countedAt: "t1", ...SCOPE });
    await saveCountLocally({ clientId: "new", itemId: 1, countedQty: 2, isMatch: false, countedAt: "t2", ...SCOPE });
    await markCountSynced("new");
    expect(await syncedState("old")).toBe(SYNCED_DONE);
    expect(await syncedState("other-item")).toBe(SYNCED_PENDING);
  });
});

describe("offline item cache", () => {
  const payload = {
    items: [{ ...item(1), checkStatus: "accepted", hasPendingVerification: true }],
    verificationItems: [{ verificationId: 7 }],
    serialVerificationTasks: [],
    members: ["Ann"],
  };

  it("is only readable by the session that cached it", async () => {
    await cacheTeamItems(payload, SCOPE);
    const local = await getLocalItems(SCOPE);
    expect(local?.items[0]).toMatchObject({ id: 1, checkStatus: "accepted", hasPendingVerification: true });
    expect(local?.extras).toEqual({ verificationItems: [{ verificationId: 7 }], serialVerificationTasks: [], members: ["Ann"] });
    expect(await getLocalItems(OTHER)).toBeNull();
    expect(await getCachedItemsScope()).toEqual(SCOPE);
  });

  it("preloadItems caches under the given scope and does nothing without one", async () => {
    fetchMock.mockImplementation(async () => jsonResponse(payload));
    expect(await preloadItems(null)).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await preloadItems(SCOPE)).toBe(1);
    expect(await getLocalItems(SCOPE)).not.toBeNull();
  });

  it("overlays the latest pending normal count per item onto loaded rows", () => {
    const rows = [
      item(1, { onHand: 5, comment: "server" }),
      item(2, { countId: 9, countedQty: 5, variance: 0, isMatch: true }),
      item(3, { checkStatus: "accepted", countId: 4, countedQty: 1 }),
      item(4),
    ];
    const pending = [
      count("a", { itemId: 1, countedQty: 2, isMatch: false, comment: "first" }),
      count("b", { itemId: 1, countedQty: 3, isMatch: false, countedAt: "t-late" }),
      count("c", { itemId: 2, countedQty: 6, isMatch: false, comment: "" }),
      count("d", { itemId: 3, countedQty: 9 }),
      count("v", { itemId: 4, verificationId: 1 }),
    ];
    const out = overlayPendingCounts(rows, pending);
    expect(out[0]).toMatchObject({ countId: -1, countedQty: 3, variance: -2, isMatch: false, comment: "first", countedAt: "t-late" });
    expect(out[1]).toMatchObject({ countId: 9, countedQty: 6, variance: 1, comment: null });
    expect(out[2]).toBe(rows[2]); // supervisor-accepted: left as the server has it
    expect(out[3]).toBe(rows[3]); // verification counts are not overlaid
  });
});

describe("rejected records", () => {
  it("lists rejected counts and discrepancies in scope", async () => {
    await offlineDb.counts.bulkPut([
      count("r1", { synced: SYNCED_REJECTED, syncError: "Reviewed by supervisor" }),
      count("r-other", { ...OTHER, synced: SYNCED_REJECTED }),
      count("p1"),
    ]);
    await saveDiscrepancyLocally(disc("d1"), SCOPE);
    await offlineDb.serialDiscrepancies.update("d1", { synced: SYNCED_REJECTED, syncError: "bad" });

    const rejected = await getRejectedRecords(SCOPE);
    expect(rejected.counts.map((c) => c.clientId)).toEqual(["r1"]);
    expect(rejected.discrepancies.map((d) => d.clientId)).toEqual(["d1"]);
  });

  it("retry re-queues rejected records but drops counts superseded by a newer local count", async () => {
    await offlineDb.counts.bulkPut([
      count("stale", { itemId: 1, seq: 1, synced: SYNCED_REJECTED, syncError: "x" }),
      count("newer", { itemId: 1, seq: 2, synced: SYNCED_DONE }),
      count("lone", { itemId: 2, seq: 3, synced: SYNCED_REJECTED, syncError: "x" }),
    ]);
    await saveDiscrepancyLocally(disc("d1"), SCOPE);
    await offlineDb.serialDiscrepancies.update("d1", { synced: SYNCED_REJECTED });

    expect(await retryRejectedRecords(["stale", "lone"], ["d1"])).toEqual({ requeued: 2, dropped: 1 });
    expect(await offlineDb.counts.get("stale")).toBeUndefined();
    expect(await offlineDb.counts.get("lone")).toMatchObject({ synced: SYNCED_PENDING });
    expect((await offlineDb.counts.get("lone"))?.syncError).toBeUndefined();
    expect((await offlineDb.serialDiscrepancies.get("d1"))?.synced).toBe(SYNCED_PENDING);
  });

  it("dismiss deletes only rejected records", async () => {
    await offlineDb.counts.bulkPut([count("r1", { synced: SYNCED_REJECTED }), count("p1")]);
    await dismissRejectedRecords(["r1", "p1"]);
    expect(await offlineDb.counts.get("r1")).toBeUndefined();
    expect(await syncedState("p1")).toBe(SYNCED_PENDING);
  });
});
