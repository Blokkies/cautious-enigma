import "fake-indexeddb/auto";
import Dexie from "dexie";
import { describe, expect, it } from "vitest";

describe("offline DB v3 -> v4 upgrade", () => {
  it("keeps existing rows and assigns seq in (countedAt, clientId) order", async () => {
    // Simulate a browser that still has the v3 schema with pending counts.
    const legacy = new Dexie("stocktake-offline");
    legacy.version(3).stores({
      items: "id, binNumber, itemCode, brand",
      counts: "clientId, itemId, synced",
      serialDiscrepancies: "clientId, synced",
      meta: "key",
    });
    await legacy.table("counts").bulkPut([
      { clientId: "zzz", itemId: 1, countedQty: 1, isMatch: true, countedAt: "t1", synced: 0, eventId: 1, teamId: 10 },
      { clientId: "aaa", itemId: 1, countedQty: 2, isMatch: true, countedAt: "t1", synced: 0, eventId: 1, teamId: 10 },
      { clientId: "early", itemId: 2, countedQty: 3, isMatch: true, countedAt: "t0", synced: 1 },
    ]);
    await legacy.table("serialDiscrepancies").put({
      clientId: "d1", itemCode: "X", description: null, binNumber: null, binInternalId: null,
      unknownSerials: ["S"], createdAt: "t", synced: 0,
    });
    legacy.close();

    const { offlineDb, getUnsyncedCounts, getUnsyncedDiscrepancies, saveCountLocally } = await import("./offline-db");
    await offlineDb.open();
    expect(offlineDb.verno).toBe(4);

    const seqOf = async (id: string) => (await offlineDb.counts.get(id))?.seq;
    expect(await seqOf("early")).toBe(1);
    expect(await seqOf("aaa")).toBe(2);
    expect(await seqOf("zzz")).toBe(3);

    // Pre-upgrade tie-break (clientId order -> "zzz" last) is preserved.
    expect((await getUnsyncedCounts({ eventId: 1, teamId: 10 })).map((c) => c.clientId)).toEqual(["aaa", "zzz"]);
    // Legacy unscoped discrepancy is still synced by the session.
    expect(await getUnsyncedDiscrepancies({ eventId: 1, teamId: 10 })).toHaveLength(1);

    // New saves continue the sequence.
    await saveCountLocally({ clientId: "new", itemId: 1, countedQty: 5, isMatch: true, countedAt: "t1", eventId: 1, teamId: 10 });
    expect(await seqOf("new")).toBe(4);
  });
});
