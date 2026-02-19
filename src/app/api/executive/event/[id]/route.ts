import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { stocktakeEvents, items, counts, teams, queries, breakdowns, serialDiscrepancies } from "@/lib/db/schema";
import { eq, and, sql, isNotNull } from "drizzle-orm";
import { getApiUser } from "@/lib/api-auth";

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

  // Overall stats
  const [
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
  ] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(items).where(and(eq(items.eventId, eventId), isNotNull(items.teamId))),
    db.select({ count: sql<number>`count(*)` }).from(counts).where(and(eq(counts.eventId, eventId), eq(counts.countType, "initial"))),
    db.select({ count: sql<number>`count(*)` }).from(counts).where(and(eq(counts.eventId, eventId), eq(counts.countType, "initial"), eq(counts.isMatch, true))),
    db.select({ count: sql<number>`count(*)` }).from(counts).where(and(eq(counts.eventId, eventId), eq(counts.countType, "initial"), eq(counts.isMatch, false))),
    db.select({ total: sql<number>`COALESCE(sum(abs(variance_value)), 0)` }).from(counts).where(and(eq(counts.eventId, eventId), eq(counts.countType, "initial"), eq(counts.isMatch, false))),
    db.select({ count: sql<number>`count(*)`, total: sql<number>`COALESCE(sum(abs(variance_value)), 0)` }).from(counts).where(and(eq(counts.eventId, eventId), eq(counts.countType, "initial"), eq(counts.isMatch, false), sql`variance > 0`)),
    db.select({ count: sql<number>`count(*)`, total: sql<number>`COALESCE(sum(abs(variance_value)), 0)` }).from(counts).where(and(eq(counts.eventId, eventId), eq(counts.countType, "initial"), eq(counts.isMatch, false), sql`variance < 0`)),
    db.select({ count: sql<number>`count(*)` }).from(queries).where(and(eq(queries.eventId, eventId), eq(queries.status, "open"))),
    db.select({ count: sql<number>`count(*)` }).from(breakdowns).where(and(eq(breakdowns.eventId, eventId), eq(breakdowns.approvalStatus, "pending"))),
    db.select({ count: sql<number>`count(*)` }).from(serialDiscrepancies).where(and(eq(serialDiscrepancies.eventId, eventId), eq(serialDiscrepancies.status, "open"))),
  ]);

  const total = totalItemsRow?.count || 0;
  const counted = countedItemsRow?.count || 0;

  // Per-team stats
  const teamList = await db.select().from(teams).where(eq(teams.eventId, eventId));

  const teamProgress = await Promise.all(teamList.map(async (team) => {
    const [[teamTotal], [teamCounted], [teamVariances], [lastCount]] = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(items).where(and(eq(items.eventId, eventId), eq(items.teamId, team.id))),
      db.select({ count: sql<number>`count(*)` }).from(counts).where(and(eq(counts.eventId, eventId), eq(counts.teamId, team.id), eq(counts.countType, "initial"))),
      db.select({ count: sql<number>`count(*)` }).from(counts).where(and(eq(counts.eventId, eventId), eq(counts.teamId, team.id), eq(counts.countType, "initial"), eq(counts.isMatch, false))),
      db.select({ countedAt: counts.countedAt }).from(counts).where(and(eq(counts.eventId, eventId), eq(counts.teamId, team.id))).orderBy(sql`counted_at DESC`).limit(1),
    ]);

    const t = teamTotal?.count || 0;
    const c = teamCounted?.count || 0;
    return {
      id: team.id,
      name: team.name,
      members: team.members,
      total: t,
      counted: c,
      pending: t - c,
      variances: teamVariances?.count || 0,
      progressPercent: t > 0 ? Math.round((c / t) * 100) : 0,
      lastActivity: lastCount?.countedAt || null,
    };
  }));

  // Recent activity
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
    .where(eq(counts.eventId, eventId))
    .orderBy(sql`counted_at DESC`)
    .limit(20);

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
      matched: matchedItemsRow?.count || 0,
      withVariance: varianceItemsRow?.count || 0,
      varianceValue: varianceValueRow?.total || 0,
      overCount: overStats?.count || 0,
      overValue: overStats?.total || 0,
      underCount: underStats?.count || 0,
      underValue: underStats?.total || 0,
      netVarianceValue: (overStats?.total || 0) - (underStats?.total || 0),
      pending: total - counted,
      progressPercent: total > 0 ? Math.round((counted / total) * 100) : 0,
      openQueries: openQueriesRow?.count || 0,
      pendingBreakdowns: pendingBreakdownsRow?.count || 0,
      openSerialDiscrepancies: openSerialsRow?.count || 0,
    },
    teamProgress,
    recentActivity,
  });
}
