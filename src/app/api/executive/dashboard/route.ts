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
import {
  requireUser, getEventWarehouses, warehouseFilter, countsWarehouseFilter,
  buildItemRefMap, isRefOutsideWarehouses, getCountableDiscrepancySerials,
} from "@/lib/api-auth";
import { countInt, sumFloat } from "@/lib/db/aggregates";

/**
 * Serial-discrepancy surplus (unknown + approved serials) grouped by the
 * warehouse of the source item. Same rules as getSerialDiscrepancyOverStats,
 * so the per-warehouse rows add up to the event's overCount/overValue.
 */
async function getSerialOverByWarehouse(eventId: number, warehouses: string[] | null) {
  const byWarehouse = new Map<string, { overCount: number; overValue: number }>();
  const discRows = await db
    .select({
      itemCode: serialDiscrepancies.itemCode,
      unknownSerials: serialDiscrepancies.unknownSerials,
      approvedSerials: serialDiscrepancies.approvedSerials,
      status: serialDiscrepancies.status,
    })
    .from(serialDiscrepancies)
    .where(eq(serialDiscrepancies.eventId, eventId));
  if (discRows.length === 0) return byWarehouse;

  const refMap = await buildItemRefMap(eventId, discRows.map((d) => d.itemCode), warehouses);
  for (const disc of discRows) {
    const ref = refMap.get(disc.itemCode);
    if (isRefOutsideWarehouses(ref, warehouses)) continue;
    const { unknowns, approved } = getCountableDiscrepancySerials(disc);
    const n = unknowns.length + approved.length;
    if (n === 0) continue;
    const key = ref?.warehouse || "Unknown";
    const entry = byWarehouse.get(key) ?? { overCount: 0, overValue: 0 };
    entry.overCount += n;
    entry.overValue += n * (ref?.avgCost ?? 0);
    byWarehouse.set(key, entry);
  }
  return byWarehouse;
}

export async function GET(request: NextRequest) {
  const auth = await requireUser(request, { roles: ["executive", "admin"], status: 401 });
  if (auth.response) return auth.response;

  const eventList = await db
    .select()
    .from(stocktakeEvents)
    .where(sql`${stocktakeEvents.status} IN ('active', 'completed', 'locked')`);

  if (eventList.length === 0) {
    return NextResponse.json({ events: [] });
  }

  // Process events sequentially to avoid connection pool exhaustion
  // (each event runs 12 queries in parallel, but events are sequential)
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

    // Per-warehouse over/under breakdown
    const warehouseConditions = [
      eq(counts.eventId, event.id),
      eq(counts.countType, "initial"),
      eq(counts.isMatch, false),
      eq(counts.itemId, items.id),
    ];
    if (warehouses && warehouses.length > 0) {
      warehouseConditions.push(warehouseFilter(warehouses)!);
    }
    const warehouseStatsRows = await db
      .select({
        warehouse: items.warehouse,
        overCount: countInt(sql`${counts.variance} > 0`),
        overValue: sumFloat(sql`abs(${counts.varianceValue})`, sql`${counts.variance} > 0`),
        underCount: countInt(sql`${counts.variance} < 0`),
        underValue: sumFloat(sql`abs(${counts.varianceValue})`, sql`${counts.variance} < 0`),
      })
      .from(counts)
      .innerJoin(items, eq(counts.itemId, items.id))
      .where(and(...warehouseConditions))
      .groupBy(items.warehouse)
      .orderBy(sql`sum(abs(${counts.varianceValue})) DESC`);

    // Merge count-based rows with serial-discrepancy overs per warehouse so the
    // rows sum to the event totals (which include the discrepancy overs).
    const serialOverByWarehouse = await getSerialOverByWarehouse(event.id, warehouses);
    const warehouseMap = new Map<string, { warehouse: string; overCount: number; overValue: number; underCount: number; underValue: number }>();
    for (const r of warehouseStatsRows) {
      const key = r.warehouse || "Unknown";
      const entry = warehouseMap.get(key) ?? { warehouse: key, overCount: 0, overValue: 0, underCount: 0, underValue: 0 };
      entry.overCount += r.overCount;
      entry.overValue += r.overValue;
      entry.underCount += r.underCount;
      entry.underValue += r.underValue;
      warehouseMap.set(key, entry);
    }
    const serialOverStats = { overCount: 0, overValue: 0 };
    for (const [key, s] of serialOverByWarehouse) {
      const entry = warehouseMap.get(key) ?? { warehouse: key, overCount: 0, overValue: 0, underCount: 0, underValue: 0 };
      entry.overCount += s.overCount;
      entry.overValue += s.overValue;
      warehouseMap.set(key, entry);
      serialOverStats.overCount += s.overCount;
      serialOverStats.overValue += s.overValue;
    }
    const warehouseStats = Array.from(warehouseMap.values()).sort(
      (a, b) => b.overValue + b.underValue - (a.overValue + a.underValue)
    );

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
      warehouseStats,
    });
  }

  return NextResponse.json({ events });
}
