import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { stocktakeEvents, items, counts, teams, queries, breakdowns, serialDiscrepancies } from "@/lib/db/schema";
import { eq, and, sql, isNotNull } from "drizzle-orm";
import { getApiUser, getEventWarehouses, warehouseFilter, countsWarehouseFilter, getSerialDiscrepancyOverStats } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
  const user = getApiUser(request);
  if (!user || (user.type !== "supervisor" && user.type !== "admin" && user.type !== "auditor" && user.type !== "executive")) {
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
  const initialOnly = eq(counts.countType, "initial");

  const [totalCounted] = await db
    .select({ count: sql<number>`count(*)` })
    .from(counts)
    .where(and(eq(counts.eventId, eventId), initialOnly, cwf));

  const [totalMatched] = await db
    .select({ count: sql<number>`count(*)` })
    .from(counts)
    .where(and(eq(counts.eventId, eventId), initialOnly, eq(counts.isMatch, true), cwf));

  const [totalVariance] = await db
    .select({ count: sql<number>`count(*)` })
    .from(counts)
    .where(and(eq(counts.eventId, eventId), initialOnly, eq(counts.isMatch, false), cwf));

  const [varianceValue] = await db
    .select({ total: sql<number>`COALESCE(sum(abs(variance_value)), 0)` })
    .from(counts)
    .where(and(eq(counts.eventId, eventId), initialOnly, eq(counts.isMatch, false), cwf));

  const [overStats] = await db
    .select({
      count: sql<number>`count(*)`,
      total: sql<number>`COALESCE(sum(abs(variance_value)), 0)`,
    })
    .from(counts)
    .where(and(eq(counts.eventId, eventId), initialOnly, eq(counts.isMatch, false), sql`variance > 0`, cwf));

  const [underStats] = await db
    .select({
      count: sql<number>`count(*)`,
      total: sql<number>`COALESCE(sum(abs(variance_value)), 0)`,
    })
    .from(counts)
    .where(and(eq(counts.eventId, eventId), initialOnly, eq(counts.isMatch, false), sql`variance < 0`, cwf));

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

  // Per-team stats (aggregated in 4 queries instead of 4×N)
  const teamList = await db.select().from(teams).where(eq(teams.eventId, eventId));

  // Assigned items per team
  const teamItemCounts = await db
    .select({ teamId: items.teamId, count: sql<number>`count(*)` })
    .from(items)
    .where(and(eq(items.eventId, eventId), isNotNull(items.teamId), warehouseFilter(warehouses)))
    .groupBy(items.teamId);
  const teamItemMap = new Map(teamItemCounts.map((r) => [r.teamId, r.count]));

  // Counted per team
  const teamCountedCounts = await db
    .select({ teamId: counts.teamId, count: sql<number>`count(*)` })
    .from(counts)
    .where(and(eq(counts.eventId, eventId), initialOnly, cwf))
    .groupBy(counts.teamId);
  const teamCountedMap = new Map(teamCountedCounts.map((r) => [r.teamId, r.count]));

  // Variances per team
  const teamVarianceCounts = await db
    .select({ teamId: counts.teamId, count: sql<number>`count(*)` })
    .from(counts)
    .where(and(eq(counts.eventId, eventId), initialOnly, eq(counts.isMatch, false), cwf))
    .groupBy(counts.teamId);
  const teamVarianceMap = new Map(teamVarianceCounts.map((r) => [r.teamId, r.count]));

  // Last activity per team
  const teamLastActivity = await db
    .select({ teamId: counts.teamId, lastAt: sql<string>`max(counted_at)` })
    .from(counts)
    .where(and(eq(counts.eventId, eventId), cwf))
    .groupBy(counts.teamId);
  const teamLastMap = new Map(teamLastActivity.map((r) => [r.teamId, r.lastAt]));

  const teamProgress = teamList.map((team) => {
    const total = teamItemMap.get(team.id) || 0;
    const counted = teamCountedMap.get(team.id) || 0;
    return {
      id: team.id,
      name: team.name,
      members: team.members,
      total,
      counted,
      pending: total - counted,
      variances: teamVarianceMap.get(team.id) || 0,
      progressPercent: total > 0 ? Math.round((counted / total) * 100) : 0,
      lastActivity: teamLastMap.get(team.id) || null,
    };
  });

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
    .where(and(eq(counts.eventId, eventId), initialOnly, warehouseFilter(warehouses)))
    .orderBy(sql`counted_at DESC`)
    .limit(20);

  const serialOverStats = await getSerialDiscrepancyOverStats(eventId, warehouses);

  const total = totalItems?.count || 0;
  const counted = totalCounted?.count || 0;

  const combinedOverCount = (overStats?.count || 0) + serialOverStats.overCount;
  const combinedOverValue = (overStats?.total || 0) + serialOverStats.overValue;
  const combinedUnderCount = underStats?.count || 0;
  const combinedUnderValue = underStats?.total || 0;

  return NextResponse.json({
    overall: {
      total,
      counted,
      matched: totalMatched?.count || 0,
      withVariance: (totalVariance?.count || 0) + serialOverStats.overCount,
      varianceValue: (varianceValue?.total || 0) + serialOverStats.overValue,
      overCount: combinedOverCount,
      overValue: combinedOverValue,
      underCount: combinedUnderCount,
      underValue: combinedUnderValue,
      netVarianceValue: combinedOverValue - combinedUnderValue,
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
