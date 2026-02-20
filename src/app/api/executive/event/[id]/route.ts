import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { stocktakeEvents, items, counts, teams, queries, breakdowns, serialDiscrepancies } from "@/lib/db/schema";
import { eq, and, sql, isNotNull, inArray } from "drizzle-orm";
import { getApiUser, getEventWarehouses, warehouseFilter, countsWarehouseFilter } from "@/lib/api-auth";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = getApiUser(request);
  if (!user || (user.type !== "executive" && user.type !== "admin")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const eventId = Number(id);
  if (!eventId) {
    return NextResponse.json({ error: "Invalid event ID" }, { status: 400 });
  }

  const [event] = await db.select().from(stocktakeEvents).where(eq(stocktakeEvents.id, eventId));
  if (!event) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  const warehouses = await getEventWarehouses(eventId);
  const cwf = countsWarehouseFilter(eventId, warehouses);

  // Fetch team list + overall stats + recent activity in parallel
  const [
    teamList,
    [totalItemsRow],
    [countedItemsRow],
    [matchedItemsRow],
    [varianceItemsRow],
    [varianceValueRow],
    [overStats],
    [underStats],
    [openQueriesRow],
    [pendingBreakdownsRow],
    [openSerialsRow],
    recentActivity,
  ] = await Promise.all([
    db.select().from(teams).where(eq(teams.eventId, eventId)),
    db.select({ count: sql<number>`count(*)` }).from(items).where(and(eq(items.eventId, eventId), isNotNull(items.teamId), warehouseFilter(warehouses))),
    db.select({ count: sql<number>`count(*)` }).from(counts).where(and(eq(counts.eventId, eventId), eq(counts.countType, "initial"), cwf)),
    db.select({ count: sql<number>`count(*)` }).from(counts).where(and(eq(counts.eventId, eventId), eq(counts.countType, "initial"), eq(counts.isMatch, true), cwf)),
    db.select({ count: sql<number>`count(*)` }).from(counts).where(and(eq(counts.eventId, eventId), eq(counts.countType, "initial"), eq(counts.isMatch, false), cwf)),
    db.select({ total: sql<number>`COALESCE(sum(abs(variance_value)), 0)` }).from(counts).where(and(eq(counts.eventId, eventId), eq(counts.countType, "initial"), eq(counts.isMatch, false), cwf)),
    db.select({ count: sql<number>`count(*)`, total: sql<number>`COALESCE(sum(abs(variance_value)), 0)` }).from(counts).where(and(eq(counts.eventId, eventId), eq(counts.countType, "initial"), eq(counts.isMatch, false), sql`variance > 0`, cwf)),
    db.select({ count: sql<number>`count(*)`, total: sql<number>`COALESCE(sum(abs(variance_value)), 0)` }).from(counts).where(and(eq(counts.eventId, eventId), eq(counts.countType, "initial"), eq(counts.isMatch, false), sql`variance < 0`, cwf)),
    db.select({ count: sql<number>`count(*)` }).from(queries).where(and(eq(queries.eventId, eventId), eq(queries.status, "open"))),
    db.select({ count: sql<number>`count(*)` }).from(breakdowns).where(and(eq(breakdowns.eventId, eventId), eq(breakdowns.approvalStatus, "pending"))),
    db.select({ count: sql<number>`count(*)` }).from(serialDiscrepancies).where(and(eq(serialDiscrepancies.eventId, eventId), eq(serialDiscrepancies.status, "open"))),
    db.select({
      teamName: teams.name,
      itemCode: items.itemCode,
      countedQty: counts.countedQty,
      variance: counts.variance,
      isMatch: counts.isMatch,
      countedAt: counts.countedAt,
    })
    .from(counts)
    .innerJoin(teams, eq(counts.teamId, teams.id))
    .innerJoin(items, eq(counts.itemId, items.id))
    .where(and(eq(counts.eventId, eventId), cwf))
    .orderBy(sql`counted_at DESC`)
    .limit(20),
  ]);

  const total = Number(totalItemsRow?.count ?? 0);
  const counted = Number(countedItemsRow?.count ?? 0);

  // Per-team stats — batch with GROUP BY
  const teamIds = teamList.map((t) => t.id);

  let teamTotalRows: { teamId: number; count: number }[] = [];
  let teamCountedRows: { teamId: number; count: number }[] = [];
  let teamVarianceRows: { teamId: number; count: number }[] = [];
  let teamLastCountRows: { teamId: number; countedAt: string }[] = [];

  if (teamIds.length > 0) {
    const [tt, tc, tv, tl] = await Promise.all([
      db.select({ teamId: items.teamId, count: sql<number>`count(*)` })
        .from(items)
        .where(and(eq(items.eventId, eventId), inArray(items.teamId, teamIds), warehouseFilter(warehouses)))
        .groupBy(items.teamId),
      db.select({ teamId: counts.teamId, count: sql<number>`count(*)` })
        .from(counts)
        .where(and(eq(counts.eventId, eventId), inArray(counts.teamId, teamIds), eq(counts.countType, "initial"), cwf))
        .groupBy(counts.teamId),
      db.select({ teamId: counts.teamId, count: sql<number>`count(*)` })
        .from(counts)
        .where(and(eq(counts.eventId, eventId), inArray(counts.teamId, teamIds), eq(counts.countType, "initial"), eq(counts.isMatch, false), cwf))
        .groupBy(counts.teamId),
      db.select({ teamId: counts.teamId, countedAt: sql<string>`max(counted_at)` })
        .from(counts)
        .where(and(eq(counts.eventId, eventId), inArray(counts.teamId, teamIds), cwf))
        .groupBy(counts.teamId),
    ]);
    teamTotalRows = tt as typeof teamTotalRows;
    teamCountedRows = tc as typeof teamCountedRows;
    teamVarianceRows = tv as typeof teamVarianceRows;
    teamLastCountRows = tl as typeof teamLastCountRows;
  }

  const teamProgress = teamList.map((team) => {
    const t = Number(teamTotalRows.find((r) => r.teamId === team.id)?.count ?? 0);
    const c = Number(teamCountedRows.find((r) => r.teamId === team.id)?.count ?? 0);
    const v = Number(teamVarianceRows.find((r) => r.teamId === team.id)?.count ?? 0);
    const lastActivity = teamLastCountRows.find((r) => r.teamId === team.id)?.countedAt || null;

    return {
      id: team.id,
      name: team.name,
      members: team.members,
      total: t,
      counted: c,
      pending: t - c,
      variances: v,
      progressPercent: t > 0 ? Math.round((c / t) * 100) : 0,
      lastActivity,
    };
  });

  return NextResponse.json({
    event: {
      id: event.id,
      name: event.name,
      location: event.location,
      status: event.status,
      startDate: event.startDate,
    },
    overall: {
      total,
      counted,
      matched: Number(matchedItemsRow?.count ?? 0),
      withVariance: Number(varianceItemsRow?.count ?? 0),
      varianceValue: Number(varianceValueRow?.total ?? 0),
      overCount: Number(overStats?.count ?? 0),
      overValue: Number(overStats?.total ?? 0),
      underCount: Number(underStats?.count ?? 0),
      underValue: Number(underStats?.total ?? 0),
      netVarianceValue: Number(overStats?.total ?? 0) - Number(underStats?.total ?? 0),
      pending: total - counted,
      progressPercent: total > 0 ? Math.round((counted / total) * 100) : 0,
      openQueries: Number(openQueriesRow?.count ?? 0),
      pendingBreakdowns: Number(pendingBreakdownsRow?.count ?? 0),
      openSerialDiscrepancies: Number(openSerialsRow?.count ?? 0),
    },
    teamProgress,
    recentActivity,
  });
}
