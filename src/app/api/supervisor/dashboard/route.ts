import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { stocktakeEvents, items, counts, teams, queries, breakdowns, serialDiscrepancies } from "@/lib/db/schema";
import { eq, and, sql, isNotNull } from "drizzle-orm";
import { getApiUser, getEventWarehouses, warehouseFilter, countsWarehouseFilter } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
  const user = getApiUser(request);
  if (!user || (user.type !== "supervisor" && user.type !== "admin" && user.type !== "auditor")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let eventId = user.eventId;

  // Admin has eventId=0 — allow explicit eventId param, fallback to latest
  if (!eventId || eventId === 0) {
    const paramEventId = request.nextUrl.searchParams.get("eventId");
    if (paramEventId) {
      eventId = Number(paramEventId);
    } else {
      const [latest] = await db
        .select()
        .from(stocktakeEvents)
        .orderBy(sql`id DESC`)
        .limit(1);
      if (latest) eventId = latest.id;
    }
  }

  const warehouses = await getEventWarehouses(eventId);

  // Overall stats (only assigned items count toward completion)
  const [totalItems] = await db
    .select({ count: sql<number>`count(*)` })
    .from(items)
    .where(and(eq(items.eventId, eventId), isNotNull(items.teamId), warehouseFilter(warehouses)));

  const cwf = countsWarehouseFilter(eventId, warehouses);

  const [totalCounted] = await db
    .select({ count: sql<number>`count(*)` })
    .from(counts)
    .where(and(eq(counts.eventId, eventId), cwf));

  const [totalMatched] = await db
    .select({ count: sql<number>`count(*)` })
    .from(counts)
    .where(and(eq(counts.eventId, eventId), eq(counts.isMatch, true), cwf));

  const [totalVariance] = await db
    .select({ count: sql<number>`count(*)` })
    .from(counts)
    .where(and(eq(counts.eventId, eventId), eq(counts.isMatch, false), cwf));

  const [varianceValue] = await db
    .select({ total: sql<number>`COALESCE(sum(abs(variance_value)), 0)` })
    .from(counts)
    .where(and(eq(counts.eventId, eventId), eq(counts.isMatch, false), cwf));

  const [overStats] = await db
    .select({
      count: sql<number>`count(*)`,
      total: sql<number>`COALESCE(sum(abs(variance_value)), 0)`,
    })
    .from(counts)
    .where(and(eq(counts.eventId, eventId), eq(counts.isMatch, false), sql`variance > 0`, cwf));

  const [underStats] = await db
    .select({
      count: sql<number>`count(*)`,
      total: sql<number>`COALESCE(sum(abs(variance_value)), 0)`,
    })
    .from(counts)
    .where(and(eq(counts.eventId, eventId), eq(counts.isMatch, false), sql`variance < 0`, cwf));

  const [openQueries] = await db
    .select({ count: sql<number>`count(*)` })
    .from(queries)
    .where(and(eq(queries.eventId, eventId), eq(queries.status, "open")));

  const [pendingBreakdowns] = await db
    .select({ count: sql<number>`count(*)` })
    .from(breakdowns)
    .where(
      and(
        eq(breakdowns.eventId, eventId),
        eq(breakdowns.approvalStatus, "pending")
      )
    );

  const [openSerialDiscrepancies] = await db
    .select({ count: sql<number>`count(*)` })
    .from(serialDiscrepancies)
    .where(
      and(
        eq(serialDiscrepancies.eventId, eventId),
        eq(serialDiscrepancies.status, "open")
      )
    );

  // Per-team stats
  const teamList = await db.select().from(teams).where(eq(teams.eventId, eventId));

  const teamProgress = await Promise.all(teamList.map(async (team) => {
    const [teamTotal] = await db
      .select({ count: sql<number>`count(*)` })
      .from(items)
      .where(and(eq(items.eventId, eventId), eq(items.teamId, team.id), warehouseFilter(warehouses)));

    const [teamCounted] = await db
      .select({ count: sql<number>`count(*)` })
      .from(counts)
      .where(and(eq(counts.eventId, eventId), eq(counts.teamId, team.id), cwf));

    const [teamVariances] = await db
      .select({ count: sql<number>`count(*)` })
      .from(counts)
      .where(
        and(
          eq(counts.eventId, eventId),
          eq(counts.teamId, team.id),
          eq(counts.isMatch, false),
          cwf,
        )
      );

    const [lastCount] = await db
      .select({ countedAt: counts.countedAt })
      .from(counts)
      .where(and(eq(counts.eventId, eventId), eq(counts.teamId, team.id), cwf))
      .orderBy(sql`counted_at DESC`)
      .limit(1);

    const total = teamTotal?.count || 0;
    const counted = teamCounted?.count || 0;

    return {
      id: team.id,
      name: team.name,
      members: team.members,
      total,
      counted,
      pending: total - counted,
      variances: teamVariances?.count || 0,
      progressPercent: total > 0 ? Math.round((counted / total) * 100) : 0,
      lastActivity: lastCount?.countedAt || null,
    };
  }));

  // Recent activity (last 20 counts)
  const recentActivity = await db
    .select({
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
    .where(and(eq(counts.eventId, eventId), warehouseFilter(warehouses)))
    .orderBy(sql`counted_at DESC`)
    .limit(20);

  const total = totalItems?.count || 0;
  const counted = totalCounted?.count || 0;

  return NextResponse.json({
    overall: {
      total,
      counted,
      matched: totalMatched?.count || 0,
      withVariance: totalVariance?.count || 0,
      varianceValue: varianceValue?.total || 0,
      overCount: overStats?.count || 0,
      overValue: overStats?.total || 0,
      underCount: underStats?.count || 0,
      underValue: underStats?.total || 0,
      netVarianceValue: (overStats?.total || 0) - (underStats?.total || 0),
      pending: total - counted,
      progressPercent: total > 0 ? Math.round((counted / total) * 100) : 0,
      openQueries: openQueries?.count || 0,
      pendingBreakdowns: pendingBreakdowns?.count || 0,
      openSerialDiscrepancies: openSerialDiscrepancies?.count || 0,
    },
    teamProgress,
    recentActivity,
  });
}
