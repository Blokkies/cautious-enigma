import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { stocktakeEvents, items, counts, teams, queries, breakdowns } from "@/lib/db/schema";
import { eq, and, sql, isNotNull } from "drizzle-orm";
import { getApiUser } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
  const user = getApiUser(request);
  if (!user || (user.type !== "supervisor" && user.type !== "admin")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let eventId = user.eventId;

  // Admin has eventId=0, find the latest event
  if (!eventId || eventId === 0) {
    const latest = db
      .select()
      .from(stocktakeEvents)
      .orderBy(sql`id DESC`)
      .limit(1)
      .get();
    if (latest) eventId = latest.id;
  }

  // Overall stats (only assigned items count toward completion)
  const totalItems = db
    .select({ count: sql<number>`count(*)` })
    .from(items)
    .where(and(eq(items.eventId, eventId), isNotNull(items.teamId)))
    .get();

  const totalCounted = db
    .select({ count: sql<number>`count(*)` })
    .from(counts)
    .where(eq(counts.eventId, eventId))
    .get();

  const totalMatched = db
    .select({ count: sql<number>`count(*)` })
    .from(counts)
    .where(and(eq(counts.eventId, eventId), eq(counts.isMatch, true)))
    .get();

  const totalVariance = db
    .select({ count: sql<number>`count(*)` })
    .from(counts)
    .where(and(eq(counts.eventId, eventId), eq(counts.isMatch, false)))
    .get();

  const varianceValue = db
    .select({ total: sql<number>`COALESCE(sum(abs(variance_value)), 0)` })
    .from(counts)
    .where(and(eq(counts.eventId, eventId), eq(counts.isMatch, false)))
    .get();

  const openQueries = db
    .select({ count: sql<number>`count(*)` })
    .from(queries)
    .where(and(eq(queries.eventId, eventId), eq(queries.status, "open")))
    .get();

  const pendingBreakdowns = db
    .select({ count: sql<number>`count(*)` })
    .from(breakdowns)
    .where(
      and(
        eq(breakdowns.eventId, eventId),
        eq(breakdowns.approvalStatus, "pending")
      )
    )
    .get();

  // Per-team stats
  const teamList = db.select().from(teams).where(eq(teams.eventId, eventId)).all();

  const teamProgress = teamList.map((team) => {
    const teamTotal = db
      .select({ count: sql<number>`count(*)` })
      .from(items)
      .where(and(eq(items.eventId, eventId), eq(items.teamId, team.id)))
      .get();

    const teamCounted = db
      .select({ count: sql<number>`count(*)` })
      .from(counts)
      .where(and(eq(counts.eventId, eventId), eq(counts.teamId, team.id)))
      .get();

    const teamVariances = db
      .select({ count: sql<number>`count(*)` })
      .from(counts)
      .where(
        and(
          eq(counts.eventId, eventId),
          eq(counts.teamId, team.id),
          eq(counts.isMatch, false)
        )
      )
      .get();

    const lastCount = db
      .select({ countedAt: counts.countedAt })
      .from(counts)
      .where(and(eq(counts.eventId, eventId), eq(counts.teamId, team.id)))
      .orderBy(sql`counted_at DESC`)
      .limit(1)
      .get();

    const total = teamTotal?.count || 0;
    const counted = teamCounted?.count || 0;

    return {
      id: team.id,
      name: team.name,
      member1: team.member1,
      member2: team.member2,
      total,
      counted,
      pending: total - counted,
      variances: teamVariances?.count || 0,
      progressPercent: total > 0 ? Math.round((counted / total) * 100) : 0,
      lastActivity: lastCount?.countedAt || null,
    };
  });

  // Recent activity (last 20 counts)
  const recentActivity = db
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
    .limit(20)
    .all();

  const total = totalItems?.count || 0;
  const counted = totalCounted?.count || 0;

  return NextResponse.json({
    overall: {
      total,
      counted,
      matched: totalMatched?.count || 0,
      withVariance: totalVariance?.count || 0,
      varianceValue: varianceValue?.total || 0,
      pending: total - counted,
      progressPercent: total > 0 ? Math.round((counted / total) * 100) : 0,
      openQueries: openQueries?.count || 0,
      pendingBreakdowns: pendingBreakdowns?.count || 0,
    },
    teamProgress,
    recentActivity,
  });
}
