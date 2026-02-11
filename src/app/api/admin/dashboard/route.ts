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

  const eventList = db
    .select()
    .from(stocktakeEvents)
    .where(inArray(stocktakeEvents.status, ["active", "completed"]))
    .all();

  const events = eventList.map((event) => {
    const totalItems =
      db
        .select({ count: sql<number>`count(*)` })
        .from(items)
        .where(and(eq(items.eventId, event.id), isNotNull(items.teamId)))
        .get()?.count || 0;

    const countedItems =
      db
        .select({ count: sql<number>`count(*)` })
        .from(counts)
        .where(eq(counts.eventId, event.id))
        .get()?.count || 0;

    const matchedItems =
      db
        .select({ count: sql<number>`count(*)` })
        .from(counts)
        .where(and(eq(counts.eventId, event.id), eq(counts.isMatch, true)))
        .get()?.count || 0;

    const varianceItems =
      db
        .select({ count: sql<number>`count(*)` })
        .from(counts)
        .where(and(eq(counts.eventId, event.id), eq(counts.isMatch, false)))
        .get()?.count || 0;

    const varianceValue =
      db
        .select({
          total: sql<number>`COALESCE(sum(abs(variance_value)), 0)`,
        })
        .from(counts)
        .where(and(eq(counts.eventId, event.id), eq(counts.isMatch, false)))
        .get()?.total || 0;

    const teamCount =
      db
        .select({ count: sql<number>`count(*)` })
        .from(teams)
        .where(eq(teams.eventId, event.id))
        .get()?.count || 0;

    const supervisorCount =
      db
        .select({ count: sql<number>`count(*)` })
        .from(supervisors)
        .where(eq(supervisors.eventId, event.id))
        .get()?.count || 0;

    const openQueries =
      db
        .select({ count: sql<number>`count(*)` })
        .from(queries)
        .where(
          and(eq(queries.eventId, event.id), eq(queries.status, "open"))
        )
        .get()?.count || 0;

    const pendingBreakdowns =
      db
        .select({ count: sql<number>`count(*)` })
        .from(breakdowns)
        .where(
          and(
            eq(breakdowns.eventId, event.id),
            eq(breakdowns.approvalStatus, "pending")
          )
        )
        .get()?.count || 0;

    const openSerialDiscrepancies =
      db
        .select({ count: sql<number>`count(*)` })
        .from(serialDiscrepancies)
        .where(
          and(
            eq(serialDiscrepancies.eventId, event.id),
            eq(serialDiscrepancies.status, "open")
          )
        )
        .get()?.count || 0;

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
      progressPercent,
      teamCount,
      supervisorCount,
      openQueries,
      pendingBreakdowns,
      openSerialDiscrepancies,
    };
  });

  return NextResponse.json({ events });
}
