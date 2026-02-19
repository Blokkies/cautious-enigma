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
import { eq, and, sql, isNotNull, inArray } from "drizzle-orm";
import { getApiUser } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
  const user = getApiUser(request);
  if (!user || user.type !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const eventList = await db
    .select()
    .from(stocktakeEvents)
    .where(inArray(stocktakeEvents.status, ["active", "completed"]));

  const events = await Promise.all(eventList.map(async (event) => {
    // Run all independent queries in parallel
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
      db.select({ count: sql<number>`count(*)` }).from(items).where(and(eq(items.eventId, event.id), isNotNull(items.teamId))),
      db.select({ count: sql<number>`count(*)` }).from(counts).where(and(eq(counts.eventId, event.id), eq(counts.countType, "initial"))),
      db.select({ count: sql<number>`count(*)` }).from(counts).where(and(eq(counts.eventId, event.id), eq(counts.countType, "initial"), eq(counts.isMatch, true))),
      db.select({ count: sql<number>`count(*)` }).from(counts).where(and(eq(counts.eventId, event.id), eq(counts.countType, "initial"), eq(counts.isMatch, false))),
      db.select({ total: sql<number>`COALESCE(sum(abs(variance_value)), 0)` }).from(counts).where(and(eq(counts.eventId, event.id), eq(counts.countType, "initial"), eq(counts.isMatch, false))),
      db.select({ count: sql<number>`count(*)`, total: sql<number>`COALESCE(sum(abs(variance_value)), 0)` }).from(counts).where(and(eq(counts.eventId, event.id), eq(counts.countType, "initial"), eq(counts.isMatch, false), sql`variance > 0`)),
      db.select({ count: sql<number>`count(*)`, total: sql<number>`COALESCE(sum(abs(variance_value)), 0)` }).from(counts).where(and(eq(counts.eventId, event.id), eq(counts.countType, "initial"), eq(counts.isMatch, false), sql`variance < 0`)),
      db.select({ count: sql<number>`count(*)` }).from(teams).where(eq(teams.eventId, event.id)),
      db.select({ count: sql<number>`count(*)` }).from(supervisors).where(eq(supervisors.eventId, event.id)),
      db.select({ count: sql<number>`count(*)` }).from(queries).where(and(eq(queries.eventId, event.id), eq(queries.status, "open"))),
      db.select({ count: sql<number>`count(*)` }).from(breakdowns).where(and(eq(breakdowns.eventId, event.id), eq(breakdowns.approvalStatus, "pending"))),
      db.select({ count: sql<number>`count(*)` }).from(serialDiscrepancies).where(and(eq(serialDiscrepancies.eventId, event.id), eq(serialDiscrepancies.status, "open"))),
    ]);

    const totalItems = totalItemsRow?.count || 0;
    const countedItems = countedItemsRow?.count || 0;
    const overCount = overStats?.count || 0;
    const overValue = overStats?.total || 0;
    const underCount = underStats?.count || 0;
    const underValue = underStats?.total || 0;

    return {
      id: event.id,
      name: event.name,
      location: event.location,
      status: event.status,
      startDate: event.startDate,
      totalItems,
      countedItems,
      matchedItems: matchedItemsRow?.count || 0,
      varianceItems: varianceItemsRow?.count || 0,
      varianceValue: varianceValueRow?.total || 0,
      overCount,
      overValue,
      underCount,
      underValue,
      netVarianceValue: overValue - underValue,
      progressPercent: totalItems > 0 ? Math.round((countedItems / totalItems) * 100) : 0,
      teamCount: teamCountRow?.count || 0,
      supervisorCount: supervisorCountRow?.count || 0,
      openQueries: openQueriesRow?.count || 0,
      pendingBreakdowns: pendingBreakdownsRow?.count || 0,
      openSerialDiscrepancies: openSerialDiscrepanciesRow?.count || 0,
    };
  }));

  return NextResponse.json({ events });
}
