import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  stocktakeEvents,
  items,
  counts,
  teams,
  supervisors,
  queries,
  breakdowns,
  serialDiscrepancies,
} from "@/lib/db/schema";
import { eq, and, sql, isNotNull } from "drizzle-orm";
import { getApiUser, getEventWarehouses, warehouseFilter, countsWarehouseFilter } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
  const user = getApiUser(request);
  if (!user || user.type !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const eventList = await db
    .select()
    .from(stocktakeEvents)
    .where(sql`${stocktakeEvents.status} IN ('active', 'completed')`);

  if (eventList.length === 0) {
    return NextResponse.json({ events: [] });
  }

  // Process events sequentially to avoid connection pool exhaustion
  const events = [];
  for (const event of eventList) {
    const warehouses = await getEventWarehouses(event.id);
    const cwf = countsWarehouseFilter(event.id, warehouses);

    const [
      [totalItemsRow],
      [countedItemsRow],
      [matchedItemsRow],
      [varianceItemsRow],
      [varianceValueRow],
      [overStats],
      [underStats],
      [teamCountRow],
      [supervisorCountRow],
      [openQueriesRow],
      [pendingBreakdownsRow],
      [openSerialDiscrepanciesRow],
    ] = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(items).where(and(eq(items.eventId, event.id), isNotNull(items.teamId), warehouseFilter(warehouses))),
      db.select({ count: sql<number>`count(*)` }).from(counts).where(and(eq(counts.eventId, event.id), eq(counts.countType, "initial"), cwf)),
      db.select({ count: sql<number>`count(*)` }).from(counts).where(and(eq(counts.eventId, event.id), eq(counts.countType, "initial"), eq(counts.isMatch, true), cwf)),
      db.select({ count: sql<number>`count(*)` }).from(counts).where(and(eq(counts.eventId, event.id), eq(counts.countType, "initial"), eq(counts.isMatch, false), cwf)),
      db.select({ total: sql<number>`COALESCE(sum(abs(variance_value)), 0)` }).from(counts).where(and(eq(counts.eventId, event.id), eq(counts.countType, "initial"), eq(counts.isMatch, false), cwf)),
      db.select({ count: sql<number>`count(*)`, total: sql<number>`COALESCE(sum(abs(variance_value)), 0)` }).from(counts).where(and(eq(counts.eventId, event.id), eq(counts.countType, "initial"), eq(counts.isMatch, false), sql`variance > 0`, cwf)),
      db.select({ count: sql<number>`count(*)`, total: sql<number>`COALESCE(sum(abs(variance_value)), 0)` }).from(counts).where(and(eq(counts.eventId, event.id), eq(counts.countType, "initial"), eq(counts.isMatch, false), sql`variance < 0`, cwf)),
      db.select({ count: sql<number>`count(*)` }).from(teams).where(eq(teams.eventId, event.id)),
      db.select({ count: sql<number>`count(*)` }).from(supervisors).where(eq(supervisors.eventId, event.id)),
      db.select({ count: sql<number>`count(*)` }).from(queries).where(and(eq(queries.eventId, event.id), eq(queries.status, "open"))),
      db.select({ count: sql<number>`count(*)` }).from(breakdowns).where(and(eq(breakdowns.eventId, event.id), eq(breakdowns.approvalStatus, "pending"))),
      db.select({ count: sql<number>`count(*)` }).from(serialDiscrepancies).where(and(eq(serialDiscrepancies.eventId, event.id), eq(serialDiscrepancies.status, "open"))),
    ]);

    const totalItems = Number(totalItemsRow?.count ?? 0);
    const countedItems = Number(countedItemsRow?.count ?? 0);
    const overCount = Number(overStats?.count ?? 0);
    const overValue = Number(overStats?.total ?? 0);
    const underCount = Number(underStats?.count ?? 0);
    const underValue = Number(underStats?.total ?? 0);

    events.push({
      id: event.id,
      name: event.name,
      location: event.location,
      status: event.status,
      startDate: event.startDate,
      totalItems,
      countedItems,
      matchedItems: Number(matchedItemsRow?.count ?? 0),
      varianceItems: Number(varianceItemsRow?.count ?? 0),
      varianceValue: Number(varianceValueRow?.total ?? 0),
      overCount,
      overValue,
      underCount,
      underValue,
      netVarianceValue: overValue - underValue,
      progressPercent: totalItems > 0 ? Math.round((countedItems / totalItems) * 100) : 0,
      teamCount: Number(teamCountRow?.count ?? 0),
      supervisorCount: Number(supervisorCountRow?.count ?? 0),
      openQueries: Number(openQueriesRow?.count ?? 0),
      pendingBreakdowns: Number(pendingBreakdownsRow?.count ?? 0),
      openSerialDiscrepancies: Number(openSerialDiscrepanciesRow?.count ?? 0),
    });
  }

  return NextResponse.json({ events });
}
