import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { stocktakeEvents, items, counts } from "@/lib/db/schema";
import { eq, inArray, sql } from "drizzle-orm";

export interface ApiUser {
  id: number;
  type: "team" | "supervisor" | "admin" | "auditor" | "executive";
  name: string;
  eventId: number;
}

export function getApiUser(request: NextRequest): ApiUser | null {
  const id = request.headers.get("x-user-id");
  const type = request.headers.get("x-user-type") as ApiUser["type"];
  const name = request.headers.get("x-user-name");
  const eventId = request.headers.get("x-event-id");

  if (!id || !type || !name || !eventId) return null;

  return {
    id: Number(id),
    type,
    name: name || "",
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
