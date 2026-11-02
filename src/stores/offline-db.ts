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
  comment?: string | null; // undefined = keep existing server comment, null/"" = clear
  countedAt: string;
  synced: number; // 0 = unsynced, 1 = synced, 2 = rejected by server (number for IndexedDB indexing)
  syncError?: string; // server rejection reason when synced = 2
  verificationId?: number | null; // for verification counts
  eventId?: number; // prevent cross-session contamination
  teamId?: number; // prevent cross-session contamination
}

/** The logged-in team session that owns offline records. */
export interface OfflineScope {
  eventId: number;
  teamId: number;
}

export const SYNCED_PENDING = 0;
export const SYNCED_DONE = 1;
export const SYNCED_REJECTED = 2;

/**
 * True when an HTTP status means the server definitively rejected the request
 * (retrying will never succeed). 401 (re-login), 408 and 429 are retryable;
 * 5xx (including the service worker's offline 503) are retryable.
 */
export function isDefinitiveRejection(status: number): boolean {
  return status >= 400 && status < 500 && status !== 401 && status !== 408 && status !== 429;
}

/** True when the response was synthesized by the service worker because the network is unreachable. */
export function isServiceWorkerOffline(res: Response): boolean {
  return res.headers.get("X-SW-Offline") === "1";
}

// Records written before eventId/teamId were stored have no scope; they are
// still synced (server validates team ownership) rather than silently dropped.
function inScope(c: { eventId?: number; teamId?: number }, scope?: OfflineScope | null): boolean {
  if (!scope) return true;
  if (c.eventId === undefined && c.teamId === undefined) return true;
  return c.eventId === scope.eventId && c.teamId === scope.teamId;
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
  await offlineDb.counts.put({ ...count, synced: SYNCED_PENDING });

  // Update the local item record
  const localItem = await offlineDb.items.get(count.itemId);
  await offlineDb.items.update(count.itemId, {
    countId: -1, // placeholder until server confirms
    countedQty: count.countedQty,
    variance: count.countedQty - (localItem?.onHand || 0),
    isMatch: count.isMatch,
    ...(count.comment !== undefined ? { comment: count.comment || null } : {}),
    countedAt: count.countedAt,
  });
}

// ─── Mark a single count as synced ──────────────────────────────────────────
export async function markCountSynced(clientId: string): Promise<void> {
  await offlineDb.counts.update(clientId, { synced: SYNCED_DONE });
}

// ─── Mark counts as definitively rejected by the server ─────────────────────
// Kept (not deleted) for troubleshooting, but never retried.
export async function markCountsRejected(clientIds: string[], error?: string): Promise<void> {
  if (clientIds.length === 0) return;
  await offlineDb.counts
    .where("clientId")
    .anyOf(clientIds)
    .modify({ synced: SYNCED_REJECTED, syncError: error || "Rejected by server" });
}

// ─── Get unsynced counts (oldest first, scoped to the current session) ──────
export async function getUnsyncedCounts(scope?: OfflineScope | null): Promise<OfflineCount[]> {
  const rows = await offlineDb.counts
    .where("synced")
    .equals(SYNCED_PENDING)
    .filter((c) => inScope(c, scope))
    .toArray();
  return rows.sort((a, b) => a.countedAt.localeCompare(b.countedAt));
}

// ─── Mark counts as synced ──────────────────────────────────────────────────
export async function markSynced(clientIds: string[]): Promise<void> {
  if (clientIds.length === 0) return;
  await offlineDb.counts
    .where("clientId")
    .anyOf(clientIds)
    .modify({ synced: SYNCED_DONE });
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
export async function syncToServer(scope?: OfflineScope | null): Promise<{
  synced: number;
  failed: number;
  authExpired?: boolean;
}> {
  let totalSynced = 0;
  let totalFailed = 0;
  let authExpired = false;

  // ── Sync counts (normal + verification in single PUT) ──
  const unsyncedCounts = await getUnsyncedCounts(scope);

  // Collapse normal counts to the latest per item (list is sorted oldest first);
  // older superseded entries are marked synced without being sent.
  const latestByItem = new Map<number, OfflineCount>();
  for (const c of unsyncedCounts) {
    if (!c.verificationId) latestByItem.set(c.itemId, c);
  }
  const normalCounts = Array.from(latestByItem.values());
  const supersededIds = unsyncedCounts
    .filter((c) => !c.verificationId && latestByItem.get(c.itemId) !== c)
    .map((c) => c.clientId);
  if (supersededIds.length > 0) {
    await markSynced(supersededIds);
  }
  const verificationCounts = unsyncedCounts.filter((c) => !!c.verificationId);

  if (normalCounts.length > 0 || verificationCounts.length > 0) {
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
          verificationCounts: verificationCounts.map((c) => ({
            verificationId: c.verificationId,
            itemId: c.itemId,
            countedQty: c.countedQty,
            comment: c.comment,
            clientId: c.clientId,
            countedAt: c.countedAt,
          })),
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const successIds: string[] = [];
        // Per-item errors are definitive server rejections (validation, not
        // found, reviewed, assignment no longer pending) — never retry them.
        const rejected: Array<{ clientId: string; error?: string }> = [];

        const collect = (
          list: Array<{ success?: boolean; deduplicated?: boolean; error?: string }> | undefined,
          source: OfflineCount[]
        ) => {
          (list || []).forEach((r, i) => {
            const local = source[i];
            if (!local) return;
            if (r.success || r.deduplicated) {
              successIds.push(local.clientId);
            } else if (r.error) {
              rejected.push({ clientId: local.clientId, error: r.error });
            }
          });
        };
        collect(data.results, normalCounts);
        collect(data.verificationResults, verificationCounts);

        await markSynced(successIds);
        for (const r of rejected) {
          await markCountsRejected([r.clientId], r.error);
        }
        totalSynced += successIds.length;
        totalFailed += (normalCounts.length + verificationCounts.length) - successIds.length;
      } else if (res.status === 401) {
        authExpired = true;
        return { synced: totalSynced, failed: totalFailed, authExpired };
      } else {
        totalFailed += normalCounts.length + verificationCounts.length;
      }
    } catch {
      totalFailed += normalCounts.length + verificationCounts.length;
    }
  }

  // ── Sync serial discrepancies (single batch POST) ──
  const unsyncedDisc = await offlineDb.serialDiscrepancies
    .where("synced")
    .equals(0)
    .toArray();

  if (unsyncedDisc.length > 0) {
    try {
      const res = await fetch("/api/team/serial-discrepancies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          batch: unsyncedDisc.map((disc) => ({
            itemCode: disc.itemCode,
            description: disc.description,
            binNumber: disc.binNumber,
            binInternalId: disc.binInternalId,
            unknownSerials: disc.unknownSerials,
            clientId: disc.clientId,
          })),
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const successIds: string[] = [];
        (data.results as Array<{ success: boolean; deduplicated?: boolean }>).forEach(
          (r, i) => {
            if (r.success || r.deduplicated) {
              successIds.push(unsyncedDisc[i].clientId);
            }
          }
        );

        for (const cid of successIds) {
          await markDiscrepancySynced(cid);
        }
        totalSynced += successIds.length;
        totalFailed += unsyncedDisc.length - successIds.length;
      } else if (res.status === 401) {
        authExpired = true;
        return { synced: totalSynced, failed: totalFailed, authExpired };
      } else {
        totalFailed += unsyncedDisc.length;
      }
    } catch {
      totalFailed += unsyncedDisc.length;
    }
  }

  return { synced: totalSynced, failed: totalFailed, authExpired };
}

// ─── Get local items (for offline mode) ─────────────────────────────────────
export async function getLocalItems(): Promise<OfflineItem[]> {
  return offlineDb.items.orderBy("binNumber").toArray();
}

// ─── Get pending sync count ─────────────────────────────────────────────────
export async function getPendingSyncCount(scope?: OfflineScope | null): Promise<number> {
  const pendingCounts = await offlineDb.counts
    .where("synced")
    .equals(SYNCED_PENDING)
    .filter((c) => inScope(c, scope))
    .count();
  const pendingDisc = await offlineDb.serialDiscrepancies.where("synced").equals(0).count();
  return pendingCounts + pendingDisc;
}

// ─── Clear one session's offline data (after a successful sync) ─────────────
// Never deletes unsynced counts (this session's or anyone else's).
export async function clearSessionOfflineData(scope: OfflineScope): Promise<void> {
  await offlineDb.counts
    .filter((c) => inScope(c, scope) && c.synced !== SYNCED_PENDING)
    .delete();
  await offlineDb.serialDiscrepancies.where("synced").equals(1).delete();
  await offlineDb.items.clear();
  await offlineDb.meta.clear();
}

// ─── Clear all offline data ─────────────────────────────────────────────────
export async function clearOfflineData(): Promise<void> {
  await offlineDb.items.clear();
  await offlineDb.counts.clear();
  await offlineDb.serialDiscrepancies.clear();
  await offlineDb.meta.clear();
}
