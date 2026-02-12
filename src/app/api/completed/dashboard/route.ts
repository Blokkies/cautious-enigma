import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { stocktakeEvents, items, counts, teams } from "@/lib/db/schema";
import { eq, and, sql, isNotNull } from "drizzle-orm";
import { getApiUser } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
  const user = getApiUser(request);
  if (!user || (user.type !== "supervisor" && user.type !== "admin")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Allow explicit eventId param (for admin switching between events)
  const eventIdParam = request.nextUrl.searchParams.get("eventId");
  let eventId = eventIdParam ? Number(eventIdParam) : user.eventId;

  // Admin has eventId=0, find the latest active/completed event
  if (!eventId || eventId === 0) {
    const [latest] = await db
      .select()
      .from(stocktakeEvents)
      .orderBy(sql`id DESC`)
      .limit(1);
    if (latest) eventId = latest.id;
  }

  // Get event info
  const [event] = await db
    .select()
    .from(stocktakeEvents)
    .where(eq(stocktakeEvents.id, eventId));

  if (!event) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  // Overall stats (only assigned items count toward completion)
  const [totalItems] = await db
    .select({ count: sql<number>`count(*)` })
    .from(items)
    .where(and(eq(items.eventId, eventId), isNotNull(items.teamId)));

  const [totalCounted] = await db
    .select({ count: sql<number>`count(*)` })
    .from(counts)
    .where(eq(counts.eventId, eventId));

  const [totalMatched] = await db
    .select({ count: sql<number>`count(*)` })
    .from(counts)
    .where(and(eq(counts.eventId, eventId), eq(counts.isMatch, true)));

  const [totalVariances] = await db
    .select({ count: sql<number>`count(*)` })
    .from(counts)
    .where(and(eq(counts.eventId, eventId), eq(counts.isMatch, false)));

  const [totalVarianceValue] = await db
    .select({ total: sql<number>`COALESCE(sum(abs(variance_value)), 0)` })
    .from(counts)
    .where(and(eq(counts.eventId, eventId), eq(counts.isMatch, false)));

  const [overStats] = await db
    .select({
      count: sql<number>`count(*)`,
      total: sql<number>`COALESCE(sum(abs(variance_value)), 0)`,
    })
    .from(counts)
    .where(and(eq(counts.eventId, eventId), eq(counts.isMatch, false), sql`variance > 0`));

  const [underStats] = await db
    .select({
      count: sql<number>`count(*)`,
      total: sql<number>`COALESCE(sum(abs(variance_value)), 0)`,
    })
    .from(counts)
    .where(and(eq(counts.eventId, eventId), eq(counts.isMatch, false), sql`variance < 0`));

  const summaryOverCount = overStats?.count || 0;
  const summaryOverValue = overStats?.total || 0;
  const summaryUnderCount = underStats?.count || 0;
  const summaryUnderValue = underStats?.total || 0;
  const summaryNetVarianceValue = summaryOverValue - summaryUnderValue;

  const [totalStockValue] = await db
    .select({ total: sql<number>`COALESCE(sum(total_value), 0)` })
    .from(items)
    .where(and(eq(items.eventId, eventId), isNotNull(items.teamId)));

  // Per-team final stats
  const teamList = await db.select().from(teams).where(eq(teams.eventId, eventId));

  const teamResults = await Promise.all(teamList.map(async (team) => {
    const [teamTotal] = await db
      .select({ count: sql<number>`count(*)` })
      .from(items)
      .where(and(eq(items.eventId, eventId), eq(items.teamId, team.id)));

    const [teamCounted] = await db
      .select({ count: sql<number>`count(*)` })
      .from(counts)
      .where(and(eq(counts.eventId, eventId), eq(counts.teamId, team.id)));

    const [teamMatched] = await db
      .select({ count: sql<number>`count(*)` })
      .from(counts)
      .where(
        and(
          eq(counts.eventId, eventId),
          eq(counts.teamId, team.id),
          eq(counts.isMatch, true)
        )
      );

    const [teamVariances] = await db
      .select({ count: sql<number>`count(*)` })
      .from(counts)
      .where(
        and(
          eq(counts.eventId, eventId),
          eq(counts.teamId, team.id),
          eq(counts.isMatch, false)
        )
      );

    const [teamVarianceValue] = await db
      .select({ total: sql<number>`COALESCE(sum(abs(variance_value)), 0)` })
      .from(counts)
      .where(
        and(
          eq(counts.eventId, eventId),
          eq(counts.teamId, team.id),
          eq(counts.isMatch, false)
        )
      );

    const [teamOverStats] = await db
      .select({
        count: sql<number>`count(*)`,
        total: sql<number>`COALESCE(sum(abs(variance_value)), 0)`,
      })
      .from(counts)
      .where(
        and(
          eq(counts.eventId, eventId),
          eq(counts.teamId, team.id),
          eq(counts.isMatch, false),
          sql`variance > 0`
        )
      );

    const [teamUnderStats] = await db
      .select({
        count: sql<number>`count(*)`,
        total: sql<number>`COALESCE(sum(abs(variance_value)), 0)`,
      })
      .from(counts)
      .where(
        and(
          eq(counts.eventId, eventId),
          eq(counts.teamId, team.id),
          eq(counts.isMatch, false),
          sql`variance < 0`
        )
      );

    const total = teamTotal?.count || 0;
    const counted = teamCounted?.count || 0;

    return {
      id: team.id,
      name: team.name,
      member1: team.member1,
      member2: team.member2,
      total,
      counted,
      uncounted: total - counted,
      matched: teamMatched?.count || 0,
      variances: teamVariances?.count || 0,
      varianceValue: teamVarianceValue?.total || 0,
      overCount: teamOverStats?.count || 0,
      overValue: teamOverStats?.total || 0,
      underCount: teamUnderStats?.count || 0,
      underValue: teamUnderStats?.total || 0,
      completionPercent: total > 0 ? Math.round((counted / total) * 100) : 0,
    };
  }));

  // Top variances (by absolute value)
  const topVariances = await db
    .select({
      itemCode: items.itemCode,
      description: items.description,
      binNumber: items.binNumber,
      onHand: items.onHand,
      countedQty: counts.countedQty,
      variance: counts.variance,
      varianceValue: counts.varianceValue,
      teamName: teams.name,
      serialNumber: items.serialNumber,
      isSerialized: items.isSerialized,
    })
    .from(counts)
    .innerJoin(items, eq(counts.itemId, items.id))
    .innerJoin(teams, eq(counts.teamId, teams.id))
    .where(and(eq(counts.eventId, eventId), eq(counts.isMatch, false)))
    .orderBy(sql`abs(variance_value) DESC`)
    .limit(20);

  const total = totalItems?.count || 0;
  const counted = totalCounted?.count || 0;
  const matched = totalMatched?.count || 0;
  const variances = totalVariances?.count || 0;

  return NextResponse.json({
    event: {
      id: event.id,
      name: event.name,
      location: event.location,
      startDate: event.startDate,
      endDate: event.endDate,
      status: event.status,
    },
    summary: {
      totalItems: total,
      totalCounted: counted,
      uncounted: total - counted,
      completionPercent: total > 0 ? Math.round((counted / total) * 100) : 0,
      matched,
      matchPercent: counted > 0 ? Math.round((matched / counted) * 100) : 0,
      variances,
      totalVarianceValue: totalVarianceValue?.total || 0,
      overCount: summaryOverCount,
      overValue: summaryOverValue,
      underCount: summaryUnderCount,
      underValue: summaryUnderValue,
      netVarianceValue: summaryNetVarianceValue,
      totalStockValue: totalStockValue?.total || 0,
      variancePercent:
        (totalStockValue?.total || 0) > 0
          ? ((totalVarianceValue?.total || 0) / (totalStockValue?.total || 0) * 100).toFixed(2)
          : "0.00",
    },
    teamResults,
    topVariances,
  });
}
