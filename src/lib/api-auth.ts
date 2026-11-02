import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { stocktakeEvents, items, counts, serialDiscrepancies } from "@/lib/db/schema";
import { eq, and, inArray, sql } from "drizzle-orm";
import { safeJsonParse } from "@/lib/utils";

export interface ApiUser {
  id: number;
  type: "team" | "supervisor" | "admin" | "auditor" | "executive";
  name: string;
  eventId: number;
}

const VALID_USER_TYPES: ApiUser["type"][] = ["team", "supervisor", "admin", "auditor", "executive"];

/** Middleware URI-encodes the user name so non-Latin-1 names fit in a header. */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function getApiUser(request: NextRequest): ApiUser | null {
  const id = request.headers.get("x-user-id");
  const type = request.headers.get("x-user-type");
  const name = request.headers.get("x-user-name");
  const eventId = request.headers.get("x-event-id");

  if (!id || !type || !name || !eventId) return null;
  if (!VALID_USER_TYPES.includes(type as ApiUser["type"])) return null;

  return {
    id: Number(id),
    type: type as ApiUser["type"],
    name: safeDecode(name),
    eventId: Number(eventId),
  };
}

/**
 * Check if an event is still accepting write operations (counts, queries, breakdowns).
 * Returns null if the event is active, or an error string if it's locked/completed.
 */
export async function checkEventActive(eventId: number): Promise<string | null> {
  const [event] = await db
    .select({ status: stocktakeEvents.status })
    .from(stocktakeEvents)
    .where(eq(stocktakeEvents.id, eventId));

  if (!event) return "Event not found";
  if (event.status === "completed" || event.status === "locked") {
    return "This stocktake has been completed. No further changes are allowed.";
  }
  if (event.status === "setup") {
    return "This stocktake has not been activated yet.";
  }
  return null; // active — all good
}

/**
 * Get the selected warehouse names for an event.
 * Returns null if no warehouse filter is set (all warehouses included).
 */
export async function getEventWarehouses(eventId: number): Promise<string[] | null> {
  const [event] = await db
    .select({ warehouses: stocktakeEvents.warehouses })
    .from(stocktakeEvents)
    .where(eq(stocktakeEvents.id, eventId));

  if (!event?.warehouses) return null;

  try {
    const list = JSON.parse(event.warehouses) as string[];
    return list.length > 0 ? list : null;
  } catch {
    return null;
  }
}

/**
 * Build a SQL condition that filters items to the event's selected warehouses.
 * Returns undefined if no warehouse filter is set (include all).
 * Usage: .where(and(eq(items.eventId, eventId), warehouseFilter(warehouses)))
 */
/**
 * Filter items by the event's selected warehouses.
 * Returns undefined if no warehouse filter is set.
 */
export function warehouseFilter(warehouses: string[] | null) {
  if (!warehouses || warehouses.length === 0) return undefined;
  return inArray(items.warehouse, warehouses);
}

/**
 * Filter counts by warehouse via items subquery.
 * Use this when querying the counts table directly (not joined to items).
 */
export function countsWarehouseFilter(eventId: number, warehouses: string[] | null) {
  if (!warehouses || warehouses.length === 0) return undefined;
  const whParams = sql.join(warehouses.map((w) => sql`${w}`), sql`, `);
  return sql`${counts.itemId} IN (SELECT id FROM items WHERE event_id = ${eventId} AND warehouse IN (${whParams}))`;
}

export interface ItemRef {
  itemCode: string;
  internalId: string | null;
  warehouse: string | null;
  division: string | null;
  stockStatus: string | null;
  brand: string | null;
  category: string | null;
  avgCost: number | null;
}

/**
 * Look up source item metadata for serial discrepancy itemCodes.
 * When an itemCode exists in several warehouses, prefer a row in the event's
 * selected warehouses.
 */
export async function buildItemRefMap(
  eventId: number,
  itemCodes: string[],
  warehouses: string[] | null
): Promise<Map<string, ItemRef>> {
  const refMap = new Map<string, ItemRef>();
  const unique = Array.from(new Set(itemCodes));
  if (unique.length === 0) return refMap;

  const refItems = await db
    .select({
      itemCode: items.itemCode,
      internalId: items.internalId,
      warehouse: items.warehouse,
      division: items.division,
      stockStatus: items.stockStatus,
      brand: items.brand,
      category: items.category,
      avgCost: items.avgCost,
    })
    .from(items)
    .where(and(eq(items.eventId, eventId), inArray(items.itemCode, unique)));

  for (const r of refItems) {
    const existing = refMap.get(r.itemCode);
    const inSelected = !!(warehouses && warehouses.length > 0 && r.warehouse && warehouses.includes(r.warehouse));
    const existingInSelected = !!(existing && warehouses && warehouses.length > 0 && existing.warehouse && warehouses.includes(existing.warehouse));
    if (!existing || (inSelected && !existingInSelected)) {
      refMap.set(r.itemCode, r);
    }
  }
  return refMap;
}

/** True if the discrepancy's source item lies outside the event's selected warehouses. */
export function isRefOutsideWarehouses(ref: { warehouse: string | null } | undefined, warehouses: string[] | null): boolean {
  return !!(warehouses && warehouses.length > 0 && ref?.warehouse && !warehouses.includes(ref.warehouse));
}

/**
 * Serials of a discrepancy that count as surplus ("over") variances.
 * Once a discrepancy is resolved, only approved serials count — any leftover
 * unknowns are no longer outstanding, regardless of resolutionType.
 */
export function getCountableDiscrepancySerials(disc: {
  status: string | null;
  unknownSerials: string | null;
  approvedSerials: string | null;
}): { unknowns: string[]; approved: string[] } {
  const approved = safeJsonParse<string[]>(disc.approvedSerials, []);
  const unknowns = disc.status === "resolved" ? [] : safeJsonParse<string[]>(disc.unknownSerials, []);
  return { unknowns, approved };
}

/**
 * Compute serial discrepancy "over" stats for an event.
 * Unknown + approved serials are surplus items (variance > 0).
 * Returns { overCount, overValue } to be added to dashboard totals.
 */
export async function getSerialDiscrepancyOverStats(
  eventId: number,
  warehouses: string[] | null
): Promise<{ overCount: number; overValue: number }> {
  const discRows = await db
    .select({
      itemCode: serialDiscrepancies.itemCode,
      unknownSerials: serialDiscrepancies.unknownSerials,
      approvedSerials: serialDiscrepancies.approvedSerials,
      status: serialDiscrepancies.status,
    })
    .from(serialDiscrepancies)
    .where(eq(serialDiscrepancies.eventId, eventId));

  if (discRows.length === 0) return { overCount: 0, overValue: 0 };

  const refMap = await buildItemRefMap(eventId, discRows.map((d) => d.itemCode), warehouses);

  let overCount = 0;
  let overValue = 0;

  for (const disc of discRows) {
    const ref = refMap.get(disc.itemCode);

    // Skip if warehouse-filtered out
    if (isRefOutsideWarehouses(ref, warehouses)) continue;

    const { unknowns, approved } = getCountableDiscrepancySerials(disc);
    const n = unknowns.length + approved.length;
    if (n === 0) continue;

    const avgCost = ref?.avgCost ?? 0;
    overCount += n;
    overValue += n * avgCost;
  }

  return { overCount, overValue };
}
