import Dexie, { type Table } from "dexie";

export interface OfflineItem {
  id: number; // server item ID
  itemCode: string;
  description: string | null;
  brand: string | null;
  category: string | null;
  binNumber: string | null;
  binInternalId: string | null;
  warehouse: string | null;
  division: string | null;
  onHand: number;
  avgCost: number;
  totalValue: number;
  stockStatus: string | null;
  serialNumber: string | null;
  isSerialized: boolean | number | null;
  countId: number | null;
  countedQty: number | null;
  variance: number | null;
  isMatch: boolean | number | null;
  comment: string | null;
  countedAt: string | null;
}

export interface OfflineCount {
  clientId: string; // UUID for dedup
  itemId: number;
  countedQty: number;
  isMatch: boolean;
  comment: string | null;
  countedAt: string;
  synced: number; // 0 = unsynced, 1 = synced (number for IndexedDB indexing)
  verificationId?: number | null; // for verification counts
  eventId?: number; // prevent cross-session contamination
  teamId?: number; // prevent cross-session contamination
}

export interface OfflineSerialDiscrepancy {
  clientId: string; // UUID for dedup
  itemCode: string;
  description: string | null;
  binNumber: string | null;
  binInternalId: string | null;
  unknownSerials: string[];
  createdAt: string;
  synced: number; // 0 = unsynced, 1 = synced
}

export interface SyncMeta {
  key: string;
  value: string;
}

class StocktakeOfflineDB extends Dexie {
  items!: Table<OfflineItem, number>;
  counts!: Table<OfflineCount, string>;
  serialDiscrepancies!: Table<OfflineSerialDiscrepancy, string>;
  meta!: Table<SyncMeta, string>;

  constructor() {
    super("stocktake-offline");

    // v1: original schema
    this.version(1).stores({
      items: "id, binNumber, itemCode, brand",
      counts: "clientId, itemId, synced",
      meta: "key",
    });

    // v2: synced changed from boolean to number (0/1) for reliable IndexedDB indexing
    this.version(2).stores({
      items: "id, binNumber, itemCode, brand",
      counts: "clientId, itemId, synced",
      meta: "key",
    }).upgrade(tx => {
      return tx.table("counts").toCollection().modify(count => {
        count.synced = count.synced ? 1 : 0;
      });
    });

    // v3: add serialDiscrepancies table for offline unknown serial queuing
    this.version(3).stores({
      items: "id, binNumber, itemCode, brand",
      counts: "clientId, itemId, synced",
      serialDiscrepancies: "clientId, synced",
      meta: "key",
    });
  }
}

export const offlineDb = new StocktakeOfflineDB();

// ─── Preload team items into IndexedDB ──────────────────────────────────────
export async function preloadItems(): Promise<number> {
  try {
    const res = await fetch("/api/team/items");
    if (!res.ok) return 0;

    const data = await res.json();
    const serverItems: OfflineItem[] = (data.items || []).map(
      (item: Record<string, unknown>) => ({
        id: item.id as number,
        itemCode: item.itemCode as string,
        description: item.description as string | null,
        brand: item.brand as string | null,
        category: item.category as string | null,
        binNumber: item.binNumber as string | null,
        binInternalId: item.binInternalId as string | null,
        warehouse: item.warehouse as string | null,
        division: item.division as string | null,
        onHand: (item.onHand as number) || 0,
        avgCost: (item.avgCost as number) || 0,
        totalValue: (item.totalValue as number) || 0,
        stockStatus: item.stockStatus as string | null,
        serialNumber: item.serialNumber as string | null,
        isSerialized: item.isSerialized as boolean | number | null,
        countId: item.countId as number | null,
        countedQty: item.countedQty as number | null,
        variance: item.variance as number | null,
        isMatch: item.isMatch as boolean | number | null,
        comment: item.comment as string | null,
        countedAt: item.countedAt as string | null,
      })
    );

    await offlineDb.transaction("rw", offlineDb.items, async () => {
      await offlineDb.items.clear();
      await offlineDb.items.bulkPut(serverItems);
    });

    await offlineDb.meta.put({
      key: "lastSync",
      value: new Date().toISOString(),
    });

    return serverItems.length;
  } catch {
    return 0;
  }
}

// ─── Save a count locally ───────────────────────────────────────────────────
export async function saveCountLocally(count: Omit<OfflineCount, "synced">): Promise<void> {
  await offlineDb.counts.put({ ...count, synced: 0 });

  // Update the local item record
  const localItem = await offlineDb.items.get(count.itemId);
  await offlineDb.items.update(count.itemId, {
    countId: -1, // placeholder until server confirms
    countedQty: count.countedQty,
    variance: count.countedQty - (localItem?.onHand || 0),
    isMatch: count.isMatch,
    comment: count.comment,
    countedAt: count.countedAt,
  });
}

// ─── Mark a single count as synced ──────────────────────────────────────────
export async function markCountSynced(clientId: string): Promise<void> {
  await offlineDb.counts.update(clientId, { synced: 1 });
}

// ─── Get unsynced counts ────────────────────────────────────────────────────
export async function getUnsyncedCounts(): Promise<OfflineCount[]> {
  return offlineDb.counts.where("synced").equals(0).toArray();
}

// ─── Mark counts as synced ──────────────────────────────────────────────────
export async function markSynced(clientIds: string[]): Promise<void> {
  if (clientIds.length === 0) return;
  await offlineDb.counts
    .where("clientId")
    .anyOf(clientIds)
    .modify({ synced: 1 });
}

// ─── Save a serial discrepancy locally ──────────────────────────────────────
export async function saveDiscrepancyLocally(
  discrepancy: Omit<OfflineSerialDiscrepancy, "synced">
): Promise<void> {
  await offlineDb.serialDiscrepancies.put({ ...discrepancy, synced: 0 });
}

// ─── Mark a single discrepancy as synced ────────────────────────────────────
export async function markDiscrepancySynced(clientId: string): Promise<void> {
  await offlineDb.serialDiscrepancies.update(clientId, { synced: 1 });
}

// ─── Sync queue - push unsynced counts to server ────────────────────────────
export async function syncToServer(): Promise<{
  synced: number;
  failed: number;
  authExpired?: boolean;
}> {
  let totalSynced = 0;
  let totalFailed = 0;
  let authExpired = false;

  // ── Sync counts ──
  const unsyncedCounts = await getUnsyncedCounts();

  // Separate verification counts (must go via POST individually) from normal counts (batch PUT)
  const normalCounts = unsyncedCounts.filter((c) => !c.verificationId);
  const verificationCounts = unsyncedCounts.filter((c) => !!c.verificationId);

  // Batch sync normal counts via PUT
  if (normalCounts.length > 0) {
    try {
      const res = await fetch("/api/team/count", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          counts: normalCounts.map((c) => ({
            itemId: c.itemId,
            countedQty: c.countedQty,
            isMatch: c.isMatch,
            comment: c.comment,
            clientId: c.clientId,
            countedAt: c.countedAt,
          })),
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const successIds: string[] = [];
        (data.results as Array<{ success?: boolean; deduplicated?: boolean }>).forEach(
          (r, i) => {
            if (r.success || r.deduplicated) {
              successIds.push(normalCounts[i].clientId);
            }
          }
        );

        await markSynced(successIds);
        totalSynced += successIds.length;
        totalFailed += normalCounts.length - successIds.length;
      } else if (res.status === 401) {
        authExpired = true;
        return { synced: totalSynced, failed: totalFailed, authExpired };
      } else {
        totalFailed += normalCounts.length;
      }
    } catch {
      totalFailed += normalCounts.length;
    }
  }

  // Sync verification counts individually via POST (handles verification-specific logic)
  for (const vc of verificationCounts) {
    try {
      const res = await fetch("/api/team/count", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemId: vc.itemId,
          countedQty: vc.countedQty,
          comment: vc.comment,
          clientId: vc.clientId,
          verificationId: vc.verificationId,
        }),
      });

      if (res.ok) {
        await markCountSynced(vc.clientId);
        totalSynced++;
      } else if (res.status === 401) {
        authExpired = true;
        return { synced: totalSynced, failed: totalFailed, authExpired };
      } else {
        totalFailed++;
      }
    } catch {
      totalFailed++;
    }
  }

  // ── Sync serial discrepancies ──
  const unsyncedDisc = await offlineDb.serialDiscrepancies
    .where("synced")
    .equals(0)
    .toArray();

  for (const disc of unsyncedDisc) {
    try {
      const res = await fetch("/api/team/serial-discrepancies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemCode: disc.itemCode,
          description: disc.description,
          binNumber: disc.binNumber,
          binInternalId: disc.binInternalId,
          unknownSerials: disc.unknownSerials,
          clientId: disc.clientId,
        }),
      });

      if (res.ok) {
        await markDiscrepancySynced(disc.clientId);
        totalSynced++;
      } else if (res.status === 401) {
        authExpired = true;
        return { synced: totalSynced, failed: totalFailed, authExpired };
      } else {
        totalFailed++;
      }
    } catch {
      totalFailed++;
    }
  }

  return { synced: totalSynced, failed: totalFailed, authExpired };
}

// ─── Get local items (for offline mode) ─────────────────────────────────────
export async function getLocalItems(): Promise<OfflineItem[]> {
  return offlineDb.items.orderBy("binNumber").toArray();
}

// ─── Get pending sync count ─────────────────────────────────────────────────
export async function getPendingSyncCount(): Promise<number> {
  const pendingCounts = await offlineDb.counts.where("synced").equals(0).count();
  const pendingDisc = await offlineDb.serialDiscrepancies.where("synced").equals(0).count();
  return pendingCounts + pendingDisc;
}

// ─── Clear all offline data ─────────────────────────────────────────────────
export async function clearOfflineData(): Promise<void> {
  await offlineDb.items.clear();
  await offlineDb.counts.clear();
  await offlineDb.serialDiscrepancies.clear();
  await offlineDb.meta.clear();
}
