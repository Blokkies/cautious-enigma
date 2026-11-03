import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  stocktakeEvents,
  items,
  counts,
  serialDiscrepancies,
  admins,
  executives,
  supervisors,
  teams,
} from "@/lib/db/schema";
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

export type UserRole = ApiUser["type"];

export interface RequireUserOptions {
  /** Roles allowed on this handler. */
  roles: readonly UserRole[];
  /**
   * Status returned when identity headers are missing or the role is not allowed.
   * Handlers historically use either 401 or 403; default 403.
   */
  status?: 401 | 403;
  /** Mutating handler: auditors and executives (read-only roles) get 403. */
  write?: boolean;
}

export type RequireUserResult =
  | { user: ApiUser; response?: undefined }
  | { user?: undefined; response: NextResponse };

/** Read-only roles: may view but never mutate. */
export const READ_ONLY_ROLES: readonly UserRole[] = ["auditor", "executive"];

/** Does the principal behind this token still exist? One primary-key lookup. */
export async function principalExists(user: Pick<ApiUser, "id" | "type">): Promise<boolean> {
  if (!Number.isInteger(user.id) || user.id <= 0) return false;
  let rows: { id: number }[];
  switch (user.type) {
    case "admin":
      rows = await db.select({ id: admins.id }).from(admins).where(eq(admins.id, user.id));
      break;
    case "executive":
      rows = await db.select({ id: executives.id }).from(executives).where(eq(executives.id, user.id));
      break;
    case "supervisor":
    case "auditor":
      rows = await db.select({ id: supervisors.id }).from(supervisors).where(eq(supervisors.id, user.id));
      break;
    case "team":
      rows = await db.select({ id: teams.id }).from(teams).where(eq(teams.id, user.id));
      break;
    default:
      return false;
  }
  return rows.length > 0;
}

/**
 * Authenticate and authorize a route handler.
 * Order: identity headers + role (opts.status) -> read-only check (403) ->
 * principal still exists in the DB (401, clears the session cookie).
 *
 * Usage:
 *   const auth = await requireUser(request, { roles: ["admin"] });
 *   if (auth.response) return auth.response;
 *   const { user } = auth;
 */
export async function requireUser(
  request: NextRequest,
  opts: RequireUserOptions
): Promise<RequireUserResult> {
  const user = getApiUser(request);
  if (!user || !opts.roles.includes(user.type)) {
    return { response: NextResponse.json({ error: "Unauthorized" }, { status: opts.status ?? 403 }) };
  }
  if (opts.write && READ_ONLY_ROLES.includes(user.type)) {
    return { response: NextResponse.json({ error: "Read-only access" }, { status: 403 }) };
  }
  if (!(await principalExists(user))) {
    const response = NextResponse.json({ error: "Account no longer exists" }, { status: 401 });
    response.cookies.set({ name: "stocktake-token", value: "", maxAge: 0, path: "/" });
    return { response };
  }
  return { user };
}

/**
 * Resolve the event a request operates on.
 * Admins and executives log in with eventId 0 and pick an event per request
 * (`requested`, from ?eventId or the body); everyone else is pinned to the
 * event in their token. Returns null when no usable event id is available.
 */
export function resolveEventId(user: ApiUser, requested?: unknown): number | null {
  if (user.type === "admin" || user.type === "executive") {
    if (requested !== undefined && requested !== null && requested !== "") {
      return Number(requested) || null;
    }
    return user.eventId || null;
  }
  return user.eventId;
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
  const unique = Array.from(new Set(itemCodes));
  if (unique.length === 0) return new Map<string, ItemRef>();

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

  return pickItemRefs(refItems, warehouses);
}

/**
 * Pick one reference row per itemCode. The first row seen wins, unless a later
 * row lies in the selected warehouses and the current pick does not.
 */
export function pickItemRefs(refItems: ItemRef[], warehouses: string[] | null): Map<string, ItemRef> {
  const refMap = new Map<string, ItemRef>();
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
 * Approving a whole discrepancy: move every unknown serial into the approved
 * list (deduplicated, approved order kept) and clear the unknowns, the same
 * end state as approving each serial individually on the variances page.
 * Without this, a resolved discrepancy's unknowns stop counting and their
 * value disappears.
 */
export function mergeUnknownsIntoApproved(
  unknownSerials: string | null,
  approvedSerials: string | null
): { unknownSerials: string; approvedSerials: string } {
  const approved = safeJsonParse<string[]>(approvedSerials, []);
  const unknowns = safeJsonParse<string[]>(unknownSerials, []);
  const merged = Array.from(new Set([...approved, ...unknowns]));
  return { unknownSerials: "[]", approvedSerials: JSON.stringify(merged) };
}

/**
 * Drop serial discrepancies whose source item lies outside the event's selected
 * warehouses (same rule the variances page uses). No-op without a filter.
 */
export async function filterDiscrepanciesToWarehouses<T extends { itemCode: string }>(
  eventId: number,
  discrepancies: T[],
  warehouses: string[] | null
): Promise<T[]> {
  if (!warehouses || warehouses.length === 0 || discrepancies.length === 0) return discrepancies;
  const refMap = await buildItemRefMap(eventId, discrepancies.map((d) => d.itemCode), warehouses);
  return discrepancies.filter((d) => !isRefOutsideWarehouses(refMap.get(d.itemCode), warehouses));
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
