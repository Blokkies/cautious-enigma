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
import { requireUser, getEventWarehouses, warehouseFilter, countsWarehouseFilter, getSerialDiscrepancyOverStats } from "@/lib/api-auth";
import { countInt, sumFloat } from "@/lib/db/aggregates";

export async function GET(request: NextRequest) {
  const auth = await requireUser(request, { roles: ["admin"], status: 401 });
  if (auth.response) return auth.response;

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
      db.select({ count: countInt() }).from(items).where(and(eq(items.eventId, event.id), isNotNull(items.teamId), warehouseFilter(warehouses))),
      db.select({ count: countInt() }).from(counts).where(and(eq(counts.eventId, event.id), eq(counts.countType, "initial"), cwf)),
      db.select({ count: countInt() }).from(counts).where(and(eq(counts.eventId, event.id), eq(counts.countType, "initial"), eq(counts.isMatch, true), cwf)),
      db.select({ count: countInt() }).from(counts).where(and(eq(counts.eventId, event.id), eq(counts.countType, "initial"), eq(counts.isMatch, false), cwf)),
      db.select({ total: sumFloat(sql`abs(variance_value)`) }).from(counts).where(and(eq(counts.eventId, event.id), eq(counts.countType, "initial"), eq(counts.isMatch, false), cwf)),
      db.select({ count: countInt(), total: sumFloat(sql`abs(variance_value)`) }).from(counts).where(and(eq(counts.eventId, event.id), eq(counts.countType, "initial"), eq(counts.isMatch, false), sql`variance > 0`, cwf)),
      db.select({ count: countInt(), total: sumFloat(sql`abs(variance_value)`) }).from(counts).where(and(eq(counts.eventId, event.id), eq(counts.countType, "initial"), eq(counts.isMatch, false), sql`variance < 0`, cwf)),
      db.select({ count: countInt() }).from(teams).where(eq(teams.eventId, event.id)),
      db.select({ count: countInt() }).from(supervisors).where(eq(supervisors.eventId, event.id)),
      db.select({ count: countInt() }).from(queries).where(and(eq(queries.eventId, event.id), eq(queries.status, "open"))),
      db.select({ count: countInt() }).from(breakdowns).where(and(eq(breakdowns.eventId, event.id), eq(breakdowns.approvalStatus, "pending"))),
      db.select({ count: countInt() }).from(serialDiscrepancies).where(and(eq(serialDiscrepancies.eventId, event.id), eq(serialDiscrepancies.status, "open"))),
    ]);

    const serialOverStats = await getSerialDiscrepancyOverStats(event.id, warehouses);

    const totalItems = totalItemsRow?.count ?? 0;
    const countedItems = countedItemsRow?.count ?? 0;
    const overCount = (overStats?.count ?? 0) + serialOverStats.overCount;
    const overValue = (overStats?.total ?? 0) + serialOverStats.overValue;
    const underCount = underStats?.count ?? 0;
    const underValue = underStats?.total ?? 0;

    events.push({
      id: event.id,
      name: event.name,
      location: event.location,
      status: event.status,
      startDate: event.startDate,
      totalItems,
      countedItems,
      matchedItems: matchedItemsRow?.count ?? 0,
      varianceItems: (varianceItemsRow?.count ?? 0) + serialOverStats.overCount,
      varianceValue: (varianceValueRow?.total ?? 0) + serialOverStats.overValue,
      overCount,
      overValue,
      underCount,
      underValue,
      netVarianceValue: overValue - underValue,
      progressPercent: totalItems > 0 ? Math.round((countedItems / totalItems) * 100) : 0,
      teamCount: teamCountRow?.count ?? 0,
      supervisorCount: supervisorCountRow?.count ?? 0,
      openQueries: openQueriesRow?.count ?? 0,
      pendingBreakdowns: pendingBreakdownsRow?.count ?? 0,
      openSerialDiscrepancies: openSerialDiscrepanciesRow?.count ?? 0,
    });
  }

  return NextResponse.json({ events });
}
