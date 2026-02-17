import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { teams, supervisors, stocktakeEvents } from "@/lib/db/schema";
import { eq, or, sql } from "drizzle-orm";

export async function GET(request: NextRequest) {
  const type = request.nextUrl.searchParams.get("type");
  const eventIdParam = request.nextUrl.searchParams.get("eventId");

  // List accessible events (active or setup)
  if (type === "events") {
    const eventList = await db
      .select()
      .from(stocktakeEvents)
      .where(
        or(
          eq(stocktakeEvents.status, "active"),
          eq(stocktakeEvents.status, "setup")
        )
      );

    const enriched = await Promise.all(
      eventList.map(async (event) => {
        const [teamCount] = await db
          .select({ count: sql<number>`count(*)` })
          .from(teams)
          .where(eq(teams.eventId, event.id));

        const [supervisorCount] = await db
          .select({ count: sql<number>`count(*)` })
          .from(supervisors)
          .where(eq(supervisors.eventId, event.id));

        return {
          id: event.id,
          name: event.name,
          location: event.location,
          status: event.status,
          teamCount: teamCount?.count || 0,
          supervisorCount: supervisorCount?.count || 0,
        };
      })
    );

    return NextResponse.json({ events: enriched });
  }

  // Resolve event ID: use param, or fall back to finding active/setup event
  let resolvedEventId: number | null = null;
  if (eventIdParam) {
    resolvedEventId = Number(eventIdParam);
  } else {
    const [activeEvent] = await db
      .select()
      .from(stocktakeEvents)
      .where(eq(stocktakeEvents.status, "active"));

    let fallbackEvent = activeEvent;
    if (!fallbackEvent) {
      const [setupEvent] = await db
        .select()
        .from(stocktakeEvents)
        .where(eq(stocktakeEvents.status, "setup"));
      fallbackEvent = setupEvent;
    }

    resolvedEventId = fallbackEvent?.id ?? null;
  }

  if (!resolvedEventId) {
    return NextResponse.json({ items: [] });
  }

  if (type === "team") {
    const teamList = await db
      .select({ id: teams.id, name: teams.name, members: teams.members })
      .from(teams)
      .where(eq(teams.eventId, resolvedEventId));
    return NextResponse.json({ items: teamList });
  }

  if (type === "supervisor") {
    const supervisorList = await db
      .select({ id: supervisors.id, name: supervisors.name })
      .from(supervisors)
      .where(eq(supervisors.eventId, resolvedEventId));
    return NextResponse.json({ items: supervisorList });
  }

  return NextResponse.json({ items: [] });
}
