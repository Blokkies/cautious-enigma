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
    const [totalItemsRow] =
      await db
        .select({ count: sql<number>`count(*)` })
        .from(items)
        .where(and(eq(items.eventId, event.id), isNotNull(items.teamId)));

    const totalItems = totalItemsRow?.count || 0;

    const [countedItemsRow] =
      await db
        .select({ count: sql<number>`count(*)` })
        .from(counts)
        .where(eq(counts.eventId, event.id));

    const countedItems = countedItemsRow?.count || 0;

    const [matchedItemsRow] =
      await db
        .select({ count: sql<number>`count(*)` })
        .from(counts)
        .where(and(eq(counts.eventId, event.id), eq(counts.isMatch, true)));

    const matchedItems = matchedItemsRow?.count || 0;

    const [varianceItemsRow] =
      await db
        .select({ count: sql<number>`count(*)` })
        .from(counts)
        .where(and(eq(counts.eventId, event.id), eq(counts.isMatch, false)));

    const varianceItems = varianceItemsRow?.count || 0;

    const [varianceValueRow] =
      await db
        .select({
          total: sql<number>`COALESCE(sum(abs(variance_value)), 0)`,
        })
        .from(counts)
        .where(and(eq(counts.eventId, event.id), eq(counts.isMatch, false)));

    const varianceValue = varianceValueRow?.total || 0;

    const [overStats] = await db
      .select({
        count: sql<number>`count(*)`,
        total: sql<number>`COALESCE(sum(abs(variance_value)), 0)`,
      })
      .from(counts)
      .where(and(eq(counts.eventId, event.id), eq(counts.isMatch, false), sql`variance > 0`));

    const [underStats] = await db
      .select({
        count: sql<number>`count(*)`,
        total: sql<number>`COALESCE(sum(abs(variance_value)), 0)`,
      })
      .from(counts)
      .where(and(eq(counts.eventId, event.id), eq(counts.isMatch, false), sql`variance < 0`));

    const overCount = overStats?.count || 0;
    const overValue = overStats?.total || 0;
    const underCount = underStats?.count || 0;
    const underValue = underStats?.total || 0;
    const netVarianceValue = overValue - underValue;

    const [teamCountRow] =
      await db
        .select({ count: sql<number>`count(*)` })
        .from(teams)
        .where(eq(teams.eventId, event.id));

    const teamCount = teamCountRow?.count || 0;

    const [supervisorCountRow] =
      await db
        .select({ count: sql<number>`count(*)` })
        .from(supervisors)
        .where(eq(supervisors.eventId, event.id));

    const supervisorCount = supervisorCountRow?.count || 0;

    const [openQueriesRow] =
      await db
        .select({ count: sql<number>`count(*)` })
        .from(queries)
        .where(
          and(eq(queries.eventId, event.id), eq(queries.status, "open"))
        );

    const openQueries = openQueriesRow?.count || 0;

    const [pendingBreakdownsRow] =
      await db
        .select({ count: sql<number>`count(*)` })
        .from(breakdowns)
        .where(
          and(
            eq(breakdowns.eventId, event.id),
            eq(breakdowns.approvalStatus, "pending")
          )
        );

    const pendingBreakdowns = pendingBreakdownsRow?.count || 0;

    const [openSerialDiscrepanciesRow] =
      await db
        .select({ count: sql<number>`count(*)` })
        .from(serialDiscrepancies)
        .where(
          and(
            eq(serialDiscrepancies.eventId, event.id),
            eq(serialDiscrepancies.status, "open")
          )
        );

    const openSerialDiscrepancies = openSerialDiscrepanciesRow?.count || 0;

    const progressPercent =
      totalItems > 0 ? Math.round((countedItems / totalItems) * 100) : 0;

    return {
      id: event.id,
      name: event.name,
      location: event.location,
      status: event.status,
      startDate: event.startDate,
      totalItems,
      countedItems,
      matchedItems,
      varianceItems,
      varianceValue,
      overCount,
      overValue,
      underCount,
      underValue,
      netVarianceValue,
      progressPercent,
      teamCount,
      supervisorCount,
      openQueries,
      pendingBreakdowns,
      openSerialDiscrepancies,
    };
  }));

  return NextResponse.json({ events });
}
