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
  checkStatus?: string | null; // absent on items cached before it was stored
  hasPendingVerification?: boolean;
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
  seq?: number; // monotonic local save order; breaks countedAt ties (absent on legacy rows)
}

/** The logged-in team session that owns offline records. */
export interface OfflineScope {
  eventId: number;
  teamId: number;
}

export const SYNCED_PENDING = 0;
export const SYNCED_DONE = 1;
export const SYNCED_REJECTED = 2;

/** HTTP status the team write routes use while the event is not active (setup/completed/locked). */
export const EVENT_NOT_ACTIVE_STATUS = 423;

// 401 (re-login), 408 (timeout), 413 (payload too large: proxy/body limits can
// change), 423 (event temporarily not active — e.g. cancelled back to setup and
// later reactivated) and 429 (rate limited) are transient.
const RETRYABLE_4XX = new Set([401, 408, 413, EVENT_NOT_ACTIVE_STATUS, 429]);

/**
 * True when an HTTP status means the server definitively rejected the request
 * (retrying will never succeed). Transient 4xx (see RETRYABLE_4XX) and all 5xx
 * (including the service worker's offline 503) are retryable.
 */
export function isDefinitiveRejection(status: number): boolean {
  return status >= 400 && status < 500 && !RETRYABLE_4XX.has(status);
}

/** True when the response was synthesized by the service worker because the network is unreachable. */
export function isServiceWorkerOffline(res: Response): boolean {
  return res.headers.get("X-SW-Offline") === "1";
}

/**
 * Oldest-first save order: by countedAt, then by local save sequence. Rows
 * without a seq (legacy) sort before sequenced ones on a tie; Array.sort is
 * stable, so remaining ties keep their input (clientId) order.
 */
export function compareCountsBySaveOrder(
  a: Pick<OfflineCount, "countedAt" | "seq">,
  b: Pick<OfflineCount, "countedAt" | "seq">
): number {
  return a.countedAt.localeCompare(b.countedAt) || (a.seq ?? 0) - (b.seq ?? 0);
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
  synced: number; // 0 = unsynced, 1 = synced, 2 = rejected by server
  syncError?: string; // server rejection reason when synced = 2
  eventId?: number; // prevent cross-session contamination (absent on legacy rows)
  teamId?: number;
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

    // v4: index counts.seq (monotonic local save order) for same-countedAt tie-breaks.
    // Additive: existing rows get a seq in their current (countedAt, clientId) order,
    // so pre-upgrade tie-breaking is preserved.
    this.version(4).stores({
      items: "id, binNumber, itemCode, brand",
      counts: "clientId, itemId, synced, seq",
      serialDiscrepancies: "clientId, synced",
      meta: "key",
    }).upgrade(async (tx) => {
      const rows = (await tx.table("counts").toArray()) as OfflineCount[];
      rows.sort(compareCountsBySaveOrder);
      let seq = 0;
      for (const row of rows) {
        await tx.table("counts").update(row.clientId, { seq: ++seq });
      }
    });
  }
}

export const offlineDb = new StocktakeOfflineDB();

const ITEMS_SCOPE_KEY = "itemsScope";
const ITEMS_EXTRAS_KEY = "itemsExtras";

function scopeKey(scope: OfflineScope): string {
  return `${scope.eventId}:${scope.teamId}`;
}

/** Non-item parts of the /api/team/items payload cached for offline reloads. */
export interface CachedTeamExtras {
  verificationItems: unknown[];
  serialVerificationTasks: unknown[];
  members: string[];
}

// ─── Cache a /api/team/items payload in IndexedDB ───────────────────────────
// Tagged with the session scope so another team/event never reads it.
export async function cacheTeamItems(
  data: { items?: unknown[]; verificationItems?: unknown[]; serialVerificationTasks?: unknown[]; members?: string[] },
  scope: OfflineScope
): Promise<number> {
  const serverItems: OfflineItem[] = ((data.items || []) as Array<Record<string, unknown>>).map(
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
      checkStatus: (item.checkStatus as string | null) ?? null,
      hasPendingVerification: !!item.hasPendingVerification,
    })
  );

  const extras: CachedTeamExtras = {
    verificationItems: data.verificationItems || [],
    serialVerificationTasks: data.serialVerificationTasks || [],
    members: data.members || [],
  };

  await offlineDb.transaction("rw", offlineDb.items, offlineDb.meta, async () => {
    await offlineDb.items.clear();
    await offlineDb.items.bulkPut(serverItems);
    await offlineDb.meta.bulkPut([
      { key: ITEMS_SCOPE_KEY, value: scopeKey(scope) },
      { key: ITEMS_EXTRAS_KEY, value: JSON.stringify(extras) },
      { key: "lastSync", value: new Date().toISOString() },
    ]);
  });

  return serverItems.length;
}

// ─── Preload team items into IndexedDB ──────────────────────────────────────
// Without a scope nothing is cached (the cache could not be attributed to a session).
export async function preloadItems(scope?: OfflineScope | null): Promise<number> {
  if (!scope) return 0;
  try {
    const res = await fetch("/api/team/items");
    if (!res.ok) return 0;
    return await cacheTeamItems(await res.json(), scope);
  } catch {
    return 0;
  }
}

// ─── Save a count locally ───────────────────────────────────────────────────
// Resolves to the comment to send with this count. A normal count saved with
// comment === undefined ("keep the existing comment") inherits the latest
// comment set by a still-unsynced earlier count for the same item, which the
// server has not seen yet and would otherwise be lost.
export async function saveCountLocally(
  count: Omit<OfflineCount, "synced" | "seq">
): Promise<string | null | undefined> {
  let effectiveComment = count.comment;
  // Allocate the next save sequence inside the write transaction so it stays
  // monotonic even across tabs.
  await offlineDb.transaction("rw", offlineDb.counts, async () => {
    if (effectiveComment === undefined && !count.verificationId) {
      const older = (
        await offlineDb.counts
          .where("itemId")
          .equals(count.itemId)
          .filter(
            (c) =>
              c.synced === SYNCED_PENDING &&
              !c.verificationId &&
              c.eventId === count.eventId &&
              c.teamId === count.teamId
          )
          .toArray()
      ).sort(compareCountsBySaveOrder);
      for (let i = older.length - 1; i >= 0; i--) {
        if (older[i].comment !== undefined) {
          effectiveComment = older[i].comment || null;
          break;
        }
      }
    }
    const last = await offlineDb.counts.orderBy("seq").last();
    const record: OfflineCount = { ...count, synced: SYNCED_PENDING, seq: (last?.seq ?? 0) + 1 };
    if (effectiveComment !== undefined) record.comment = effectiveComment;
    await offlineDb.counts.put(record);
  });

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
  return effectiveComment;
}

// ─── Mark a single count as synced ──────────────────────────────────────────
// For a normal count, earlier still-pending counts for the same item (same
// session) are superseded by it: the server applies counts in arrival order,
// so resending them afterwards would overwrite the newer value.
export async function markCountSynced(clientId: string): Promise<void> {
  await offlineDb.transaction("rw", offlineDb.counts, async () => {
    const c = await offlineDb.counts.get(clientId);
    if (!c) return;
    await offlineDb.counts.update(clientId, { synced: SYNCED_DONE });
    if (c.verificationId) return;
    await offlineDb.counts
      .where("itemId")
      .equals(c.itemId)
      .filter(
        (o) =>
          o.synced === SYNCED_PENDING &&
          !o.verificationId &&
          o.eventId === c.eventId &&
          o.teamId === c.teamId &&
          compareCountsBySaveOrder(o, c) < 0
      )
      .modify({ synced: SYNCED_DONE });
  });
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
  return rows.sort(compareCountsBySaveOrder);
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
// Pass the session scope so the record is only ever synced by the team that
// created it. Without a complete scope it is stored unscoped (legacy behaviour:
// any session may sync it).
export async function saveDiscrepancyLocally(
  discrepancy: Omit<OfflineSerialDiscrepancy, "synced" | "syncError" | "eventId" | "teamId">,
  scope?: Partial<OfflineScope> | null
): Promise<void> {
  const record: OfflineSerialDiscrepancy = { ...discrepancy, synced: SYNCED_PENDING };
  if (scope?.eventId !== undefined && scope?.teamId !== undefined) {
    record.eventId = scope.eventId;
    record.teamId = scope.teamId;
  }
  await offlineDb.serialDiscrepancies.put(record);
}

// ─── Get unsynced serial discrepancies (scoped to the current session) ──────
export async function getUnsyncedDiscrepancies(
  scope?: OfflineScope | null
): Promise<OfflineSerialDiscrepancy[]> {
  return offlineDb.serialDiscrepancies
    .where("synced")
    .equals(SYNCED_PENDING)
    .filter((d) => inScope(d, scope))
    .toArray();
}

// ─── Mark a single discrepancy as synced ────────────────────────────────────
export async function markDiscrepancySynced(clientId: string): Promise<void> {
  await offlineDb.serialDiscrepancies.update(clientId, { synced: SYNCED_DONE });
}

/** Server-provided error message for a rejected batch, or a generic reason. */
async function rejectionReason(res: Response): Promise<string> {
  try {
    const data = await res.json();
    if (data && typeof data.error === "string" && data.error) return data.error;
  } catch {
    // non-JSON body
  }
  return `Rejected by server (HTTP ${res.status})`;
}

/**
 * Collapse pending normal (non-verification) counts to the latest per item.
 * `counts` must be sorted oldest first. A queued count with `comment ===
 * undefined` means "keep the existing comment", so when the kept entry has no
 * comment of its own, the most recent older entry that set one (including an
 * explicit clear) is carried onto it instead of being silently dropped.
 */
export function collapseQueuedCounts(counts: OfflineCount[]): {
  kept: OfflineCount[];
  supersededIds: string[];
  carriedComments: Map<string, string | null>;
} {
  const latestByItem = new Map<number, OfflineCount>();
  // Latest defined comment per item seen so far (oldest-first walk)
  const lastCommentByItem = new Map<number, string | null>();
  const supersededIds: string[] = [];
  for (const c of counts) {
    if (c.verificationId) continue;
    const prev = latestByItem.get(c.itemId);
    if (prev) supersededIds.push(prev.clientId);
    latestByItem.set(c.itemId, c);
    if (c.comment !== undefined) lastCommentByItem.set(c.itemId, c.comment || null);
  }

  const carriedComments = new Map<string, string | null>();
  const kept = Array.from(latestByItem.values()).map((c) => {
    if (c.comment !== undefined || !lastCommentByItem.has(c.itemId)) return c;
    const comment = lastCommentByItem.get(c.itemId)!;
    carriedComments.set(c.clientId, comment);
    return { ...c, comment };
  });
  return { kept, supersededIds, carriedComments };
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
  const { kept: normalCounts, supersededIds, carriedComments } = collapseQueuedCounts(unsyncedCounts);
  if (supersededIds.length > 0 || carriedComments.size > 0) {
    // Persist carried comments before dropping the superseded rows so a failed
    // send does not lose them on the next attempt.
    await offlineDb.transaction("rw", offlineDb.counts, async () => {
      for (const [clientId, comment] of carriedComments) {
        await offlineDb.counts.update(clientId, { comment });
      }
      if (supersededIds.length > 0) await markSynced(supersededIds);
    });
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
        // A definitive whole-batch rejection (e.g. 400/403) will never succeed on
        // retry: mark the batch rejected instead of resending it forever.
        if (isDefinitiveRejection(res.status)) {
          await markCountsRejected(
            [...normalCounts, ...verificationCounts].map((c) => c.clientId),
            await rejectionReason(res)
          );
        }
        totalFailed += normalCounts.length + verificationCounts.length;
      }
    } catch {
      totalFailed += normalCounts.length + verificationCounts.length;
    }
  }

  // ── Sync serial discrepancies (single batch POST) ──
  const unsyncedDisc = await getUnsyncedDiscrepancies(scope);

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
        if (isDefinitiveRejection(res.status)) {
          const syncError = await rejectionReason(res);
          await offlineDb.serialDiscrepancies
            .where("clientId")
            .anyOf(unsyncedDisc.map((d) => d.clientId))
            .modify({ synced: SYNCED_REJECTED, syncError });
        }
        totalFailed += unsyncedDisc.length;
      }
    } catch {
      totalFailed += unsyncedDisc.length;
    }
  }

  return { synced: totalSynced, failed: totalFailed, authExpired };
}

// ─── Get local items (for offline mode) ─────────────────────────────────────
// Returns the cached item list only when it was cached for this session;
// null when there is no cache for it (never another team's/event's items).
export async function getLocalItems(scope: OfflineScope): Promise<{
  items: OfflineItem[];
  extras: CachedTeamExtras;
} | null> {
  const owner = await offlineDb.meta.get(ITEMS_SCOPE_KEY);
  if (!owner || owner.value !== scopeKey(scope)) return null;
  const items = await offlineDb.items.toArray();
  let extras: CachedTeamExtras = { verificationItems: [], serialVerificationTasks: [], members: [] };
  try {
    const raw = await offlineDb.meta.get(ITEMS_EXTRAS_KEY);
    if (raw) extras = { ...extras, ...JSON.parse(raw.value) };
  } catch {
    // corrupt extras: items alone are still usable
  }
  return { items, extras };
}

/**
 * The session the item cache belongs to, if any. Lets an offline reload (where
 * the logged-in user cannot be re-validated) keep working on the last
 * session's data. The cache is cleared on logout.
 */
export async function getCachedItemsScope(): Promise<OfflineScope | null> {
  const owner = await offlineDb.meta.get(ITEMS_SCOPE_KEY);
  const m = owner?.value.match(/^(\d+):(\d+)$/);
  return m ? { eventId: Number(m[1]), teamId: Number(m[2]) } : null;
}

/** Minimal item shape the pending-count overlay needs. */
interface OverlayItem {
  id: number;
  onHand: number | null;
  countId: number | null;
  countedQty: number | null;
  variance: number | null;
  isMatch: boolean | number | null;
  comment: string | null;
  countedAt: string | null;
  checkStatus?: string | null;
}

/**
 * Apply this device's pending (unsynced) normal counts on top of item rows
 * loaded from the server or the cache, so the UI shows what was recorded
 * locally. `pending` must be sorted oldest first (getUnsyncedCounts order).
 * Verification counts are ignored; items accepted by a supervisor are left as
 * the server has them (the server will reject the pending count).
 */
export function overlayPendingCounts<T extends OverlayItem>(rows: T[], pending: OfflineCount[]): T[] {
  const byItem = new Map<number, { count: OfflineCount; comment: string | null | undefined }>();
  for (const c of pending) {
    if (c.verificationId) continue;
    const prev = byItem.get(c.itemId);
    byItem.set(c.itemId, {
      count: c,
      comment: c.comment !== undefined ? c.comment || null : prev?.comment,
    });
  }
  if (byItem.size === 0) return rows;
  return rows.map((row) => {
    const p = byItem.get(row.id);
    if (!p || row.checkStatus === "accepted") return row;
    return {
      ...row,
      countId: row.countId ?? -1,
      countedQty: p.count.countedQty,
      variance: p.count.countedQty - (row.onHand ?? 0),
      isMatch: p.count.isMatch,
      comment: p.comment === undefined ? row.comment : p.comment,
      countedAt: p.count.countedAt,
    };
  });
}

// ─── Records the server definitively rejected (shown to the user) ───────────
export interface RejectedRecords {
  counts: OfflineCount[];
  discrepancies: OfflineSerialDiscrepancy[];
}

export async function getRejectedRecords(scope?: OfflineScope | null): Promise<RejectedRecords> {
  const counts = await offlineDb.counts
    .where("synced")
    .equals(SYNCED_REJECTED)
    .filter((c) => inScope(c, scope))
    .toArray();
  const discrepancies = await offlineDb.serialDiscrepancies
    .where("synced")
    .equals(SYNCED_REJECTED)
    .filter((d) => inScope(d, scope))
    .toArray();
  return { counts: counts.sort(compareCountsBySaveOrder), discrepancies };
}

/**
 * Re-queue rejected records for another sync attempt. A rejected normal count
 * that a later local count for the same item has superseded is not resent (it
 * would overwrite the newer value) and is dropped instead.
 */
export async function retryRejectedRecords(
  countIds: string[],
  discrepancyIds: string[] = []
): Promise<{ requeued: number; dropped: number }> {
  let requeued = 0;
  let dropped = 0;
  await offlineDb.transaction("rw", offlineDb.counts, offlineDb.serialDiscrepancies, async () => {
    for (const id of countIds) {
      const c = await offlineDb.counts.get(id);
      if (!c || c.synced !== SYNCED_REJECTED) continue;
      if (!c.verificationId) {
        const newer = await offlineDb.counts
          .where("itemId")
          .equals(c.itemId)
          .filter(
            (o) =>
              o.clientId !== c.clientId &&
              !o.verificationId &&
              o.eventId === c.eventId &&
              o.teamId === c.teamId &&
              compareCountsBySaveOrder(o, c) > 0
          )
          .count();
        if (newer > 0) {
          await offlineDb.counts.delete(id);
          dropped++;
          continue;
        }
      }
      await offlineDb.counts.update(id, { synced: SYNCED_PENDING, syncError: undefined });
      requeued++;
    }
    for (const id of discrepancyIds) {
      const d = await offlineDb.serialDiscrepancies.get(id);
      if (!d || d.synced !== SYNCED_REJECTED) continue;
      await offlineDb.serialDiscrepancies.update(id, { synced: SYNCED_PENDING, syncError: undefined });
      requeued++;
    }
  });
  return { requeued, dropped };
}

/** Permanently discard rejected records the user has acknowledged. */
export async function dismissRejectedRecords(countIds: string[], discrepancyIds: string[] = []): Promise<void> {
  await offlineDb.transaction("rw", offlineDb.counts, offlineDb.serialDiscrepancies, async () => {
    if (countIds.length > 0) {
      await offlineDb.counts.where("clientId").anyOf(countIds).filter((c) => c.synced === SYNCED_REJECTED).delete();
    }
    if (discrepancyIds.length > 0) {
      await offlineDb.serialDiscrepancies
        .where("clientId")
        .anyOf(discrepancyIds)
        .filter((d) => d.synced === SYNCED_REJECTED)
        .delete();
    }
  });
}

// ─── Get pending sync count ─────────────────────────────────────────────────
export async function getPendingSyncCount(scope?: OfflineScope | null): Promise<number> {
  const pendingCounts = await offlineDb.counts
    .where("synced")
    .equals(SYNCED_PENDING)
    .filter((c) => inScope(c, scope))
    .count();
  const pendingDisc = await offlineDb.serialDiscrepancies
    .where("synced")
    .equals(SYNCED_PENDING)
    .filter((d) => inScope(d, scope))
    .count();
  return pendingCounts + pendingDisc;
}

// ─── Clear one session's offline data (after a successful sync) ─────────────
// Never deletes unsynced counts (this session's or anyone else's).
export async function clearSessionOfflineData(scope: OfflineScope): Promise<void> {
  await offlineDb.counts
    .filter((c) => inScope(c, scope) && c.synced !== SYNCED_PENDING)
    .delete();
  await offlineDb.serialDiscrepancies
    .filter((d) => inScope(d, scope) && d.synced !== SYNCED_PENDING)
    .delete();
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
