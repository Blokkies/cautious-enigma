import Dexie, { type Table } from "dexie";

export interface OfflineItem {
  id: number; // server item ID
  itemCode: string;
  description: string | null;
  brand: string | null;
  category: string | null;
  binNumber: string | null;
  warehouse: string | null;
  onHand: number;
  avgCost: number;
  totalValue: number;
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
}

export interface SyncMeta {
  key: string;
  value: string;
}

class StocktakeOfflineDB extends Dexie {
  items!: Table<OfflineItem, number>;
  counts!: Table<OfflineCount, string>;
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
    // No schema change needed (same indexes), just data migration
    this.version(2).stores({
      items: "id, binNumber, itemCode, brand",
      counts: "clientId, itemId, synced",
      meta: "key",
    }).upgrade(tx => {
      return tx.table("counts").toCollection().modify(count => {
        count.synced = count.synced ? 1 : 0;
      });
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
        warehouse: item.warehouse as string | null,
        onHand: (item.onHand as number) || 0,
        avgCost: (item.avgCost as number) || 0,
        totalValue: (item.totalValue as number) || 0,
        countId: item.countId as number | null,
        countedQty: item.countedQty as number | null,
        variance: item.variance as number | null,
        isMatch: item.isMatch as boolean | number | null,
        comment: item.comment as string | null,
        countedAt: item.countedAt as string | null,
      })
    );

    await offlineDb.items.clear();
    await offlineDb.items.bulkPut(serverItems);

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

// ─── Sync queue - push unsynced counts to server ────────────────────────────
export async function syncToServer(): Promise<{
  synced: number;
  failed: number;
}> {
  const unsynced = await getUnsyncedCounts();
  if (unsynced.length === 0) return { synced: 0, failed: 0 };

  try {
    const res = await fetch("/api/team/count", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        counts: unsynced.map((c) => ({
          itemId: c.itemId,
          countedQty: c.countedQty,
          isMatch: c.isMatch,
          comment: c.comment,
          clientId: c.clientId,
        })),
      }),
    });

    if (res.ok) {
      const data = await res.json();
      // Match results by index (server returns in same order as input)
      const successIds: string[] = [];
      (data.results as Array<{ success?: boolean; deduplicated?: boolean }>).forEach(
        (r, i) => {
          if (r.success || r.deduplicated) {
            successIds.push(unsynced[i].clientId);
          }
        }
      );

      await markSynced(successIds);

      return {
        synced: successIds.length,
        failed: unsynced.length - successIds.length,
      };
    }

    return { synced: 0, failed: unsynced.length };
  } catch {
    return { synced: 0, failed: unsynced.length };
  }
}

// ─── Get local items (for offline mode) ─────────────────────────────────────
export async function getLocalItems(): Promise<OfflineItem[]> {
  return offlineDb.items.orderBy("binNumber").toArray();
}

// ─── Get pending sync count ─────────────────────────────────────────────────
export async function getPendingSyncCount(): Promise<number> {
  return offlineDb.counts.where("synced").equals(0).count();
}

// ─── Clear all offline data ─────────────────────────────────────────────────
export async function clearOfflineData(): Promise<void> {
  await offlineDb.items.clear();
  await offlineDb.counts.clear();
  await offlineDb.meta.clear();
}
