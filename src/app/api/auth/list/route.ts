import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { teams, supervisors, stocktakeEvents } from "@/lib/db/schema";
import { eq, or, and, sql } from "drizzle-orm";

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

    // Batch count queries to avoid exhausting the connection pool
    const eventIds = eventList.map((e) => e.id);

    const teamCounts = eventIds.length
      ? await db
          .select({ eventId: teams.eventId, count: sql<number>`count(*)` })
          .from(teams)
          .groupBy(teams.eventId)
      : [];

    const supCounts = eventIds.length
      ? await db
          .select({ eventId: supervisors.eventId, role: supervisors.role, count: sql<number>`count(*)` })
          .from(supervisors)
          .groupBy(supervisors.eventId, supervisors.role)
      : [];

    const teamMap = new Map(teamCounts.map((r) => [r.eventId, Number(r.count)]));
    const supMap = new Map<string, number>();
    for (const r of supCounts) {
      supMap.set(`${r.eventId}:${r.role}`, Number(r.count));
    }

    const enriched = eventList.map((event) => ({
      id: event.id,
      name: event.name,
      location: event.location,
      status: event.status,
      teamCount: teamMap.get(event.id) || 0,
      supervisorCount: supMap.get(`${event.id}:supervisor`) || 0,
      auditorCount: supMap.get(`${event.id}:auditor`) || 0,
    }));

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
      .where(and(eq(supervisors.eventId, resolvedEventId), eq(supervisors.role, "supervisor")));
    return NextResponse.json({ items: supervisorList });
  }

  if (type === "auditor") {
    const auditorList = await db
      .select({ id: supervisors.id, name: supervisors.name })
      .from(supervisors)
      .where(and(eq(supervisors.eventId, resolvedEventId), eq(supervisors.role, "auditor")));
    return NextResponse.json({ items: auditorList });
  }

  return NextResponse.json({ items: [] });
}
