import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { teams, supervisors, stocktakeEvents } from "@/lib/db/schema";
import { eq, or, and } from "drizzle-orm";
import { countInt } from "@/lib/db/aggregates";
import { parseId } from "@/lib/ids";
import { loginStatusesFor } from "@/lib/login-events";

export async function GET(request: NextRequest) {
  const type = request.nextUrl.searchParams.get("type");
  const eventIdParam = request.nextUrl.searchParams.get("eventId");

  // List accessible events (active or setup; also completed for supervisor/auditor)
  if (type === "events") {
    const role = request.nextUrl.searchParams.get("role");
    const statuses = loginStatusesFor(role === "supervisor" || role === "auditor" ? role : "team");
    const statusConditions = statuses.map((s) => eq(stocktakeEvents.status, s));

    const eventList = await db
      .select()
      .from(stocktakeEvents)
      .where(or(...statusConditions));

    // Batch count queries to avoid exhausting the connection pool
    const eventIds = eventList.map((e) => e.id);

    const teamCounts = eventIds.length
      ? await db
          .select({ eventId: teams.eventId, count: countInt() })
          .from(teams)
          .groupBy(teams.eventId)
      : [];

    const supCounts = eventIds.length
      ? await db
          .select({ eventId: supervisors.eventId, role: supervisors.role, count: countInt() })
          .from(supervisors)
          .groupBy(supervisors.eventId, supervisors.role)
      : [];

    const teamMap = new Map(teamCounts.map((r) => [r.eventId, r.count]));
    const supMap = new Map<string, number>();
    for (const r of supCounts) {
      supMap.set(`${r.eventId}:${r.role}`, r.count);
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

  if (type !== "team" && type !== "supervisor" && type !== "auditor") {
    return NextResponse.json({ items: [] });
  }

  // Resolve the event: use the param, or fall back to the active/setup event.
  // This route is public, so it only lists accounts of events this role can
  // actually log into, and only what the login picker needs (no team members).
  let event: { id: number; status: string } | undefined;
  if (eventIdParam) {
    const eventId = parseId(eventIdParam);
    if (eventId === null) {
      return NextResponse.json({ error: "Invalid eventId" }, { status: 400 });
    }
    [event] = await db
      .select({ id: stocktakeEvents.id, status: stocktakeEvents.status })
      .from(stocktakeEvents)
      .where(eq(stocktakeEvents.id, eventId));
  } else {
    const [activeEvent] = await db
      .select({ id: stocktakeEvents.id, status: stocktakeEvents.status })
      .from(stocktakeEvents)
      .where(eq(stocktakeEvents.status, "active"));

    event = activeEvent;
    if (!event) {
      const [setupEvent] = await db
        .select({ id: stocktakeEvents.id, status: stocktakeEvents.status })
        .from(stocktakeEvents)
        .where(eq(stocktakeEvents.status, "setup"));
      event = setupEvent;
    }
  }

  if (!event || !loginStatusesFor(type).includes(event.status)) {
    return NextResponse.json({ items: [] });
  }

  if (type === "team") {
    const teamList = await db
      .select({ id: teams.id, name: teams.name })
      .from(teams)
      .where(eq(teams.eventId, event.id));
    return NextResponse.json({ items: teamList });
  }

  const staffList = await db
    .select({ id: supervisors.id, name: supervisors.name })
    .from(supervisors)
    .where(and(eq(supervisors.eventId, event.id), eq(supervisors.role, type)));
  return NextResponse.json({ items: staffList });
}
