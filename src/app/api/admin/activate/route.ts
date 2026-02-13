import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { stocktakeEvents, items, teams, supervisors, counts, queries, queryMessages, breakdowns, breakdownMessages, teamAssignments, auditLog, verificationAssignments, serialDiscrepancies } from "@/lib/db/schema";
import { eq, and, sql, isNull } from "drizzle-orm";

// GET: Check readiness
export async function GET(request: NextRequest) {
  const eventId = request.nextUrl.searchParams.get("eventId");
  if (!eventId) {
    return NextResponse.json({ error: "eventId required" }, { status: 400 });
  }

  const eid = Number(eventId);

  const [itemCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(items)
    .where(eq(items.eventId, eid));

  const [teamCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(teams)
    .where(eq(teams.eventId, eid));

  const [supervisorCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(supervisors)
    .where(eq(supervisors.eventId, eid));

  const [unassignedCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(items)
    .where(and(eq(items.eventId, eid), isNull(items.teamId)));

  return NextResponse.json({
    hasItems: (itemCount?.count || 0) > 0,
    hasTeams: (teamCount?.count || 0) > 0,
    hasSupervisors: (supervisorCount?.count || 0) > 0,
    allItemsAssigned: (unassignedCount?.count || 0) === 0,
    unassignedCount: unassignedCount?.count || 0,
  });
}

// POST: Activate event
export async function POST(request: NextRequest) {
  try {
    const { eventId } = await request.json();

    const events = await db
      .select()
      .from(stocktakeEvents)
      .where(eq(stocktakeEvents.id, Number(eventId)));

    const [event] = events;

    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    if (event.status !== "setup") {
      return NextResponse.json(
        { error: "Event is not in setup phase" },
        { status: 400 }
      );
    }

    // Activate this event
    await db.update(stocktakeEvents)
      .set({ status: "active", updatedAt: new Date().toISOString() })
      .where(eq(stocktakeEvents.id, Number(eventId)));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Activate error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// PUT: Change status (complete/lock/setup)
export async function PUT(request: NextRequest) {
  try {
    const { eventId, status } = await request.json();

    if (!["setup", "completed", "locked"].includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    await db.update(stocktakeEvents)
      .set({ status, updatedAt: new Date().toISOString() })
      .where(eq(stocktakeEvents.id, Number(eventId)));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Status update error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// DELETE: Delete an event and all associated data
export async function DELETE(request: NextRequest) {
  try {
    const { eventId } = await request.json();
    const eid = Number(eventId);

    const events = await db
      .select()
      .from(stocktakeEvents)
      .where(eq(stocktakeEvents.id, eid));

    const [event] = events;

    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    // Cascade delete all related data in correct order (children first)
    await db.delete(verificationAssignments).where(eq(verificationAssignments.eventId, eid));
    await db.delete(auditLog).where(eq(auditLog.eventId, eid));
    await db.delete(serialDiscrepancies).where(eq(serialDiscrepancies.eventId, eid));
    await db.delete(breakdownMessages).where(sql`breakdown_id IN (SELECT id FROM breakdowns WHERE event_id = ${eid})`);
    await db.delete(breakdowns).where(eq(breakdowns.eventId, eid));
    await db.delete(queryMessages).where(sql`query_id IN (SELECT id FROM queries WHERE event_id = ${eid})`);
    await db.delete(queries).where(eq(queries.eventId, eid));
    await db.delete(counts).where(eq(counts.eventId, eid));
    await db.delete(teamAssignments).where(eq(teamAssignments.eventId, eid));
    await db.delete(items).where(eq(items.eventId, eid));
    await db.delete(supervisors).where(eq(supervisors.eventId, eid));
    await db.delete(teams).where(eq(teams.eventId, eid));
    await db.delete(stocktakeEvents).where(eq(stocktakeEvents.id, eid));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete event error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
