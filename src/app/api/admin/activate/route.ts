import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { stocktakeEvents, items, teams, supervisors, counts, queries, breakdowns, teamAssignments, auditLog } from "@/lib/db/schema";
import { eq, and, sql, isNull } from "drizzle-orm";

// GET: Check readiness
export async function GET(request: NextRequest) {
  const eventId = request.nextUrl.searchParams.get("eventId");
  if (!eventId) {
    return NextResponse.json({ error: "eventId required" }, { status: 400 });
  }

  const eid = Number(eventId);

  const itemCount = db
    .select({ count: sql<number>`count(*)` })
    .from(items)
    .where(eq(items.eventId, eid))
    .get();

  const teamCount = db
    .select({ count: sql<number>`count(*)` })
    .from(teams)
    .where(eq(teams.eventId, eid))
    .get();

  const supervisorCount = db
    .select({ count: sql<number>`count(*)` })
    .from(supervisors)
    .where(eq(supervisors.eventId, eid))
    .get();

  const unassignedCount = db
    .select({ count: sql<number>`count(*)` })
    .from(items)
    .where(and(eq(items.eventId, eid), isNull(items.teamId)))
    .get();

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

    const event = db
      .select()
      .from(stocktakeEvents)
      .where(eq(stocktakeEvents.id, Number(eventId)))
      .get();

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
    db.update(stocktakeEvents)
      .set({ status: "active", updatedAt: new Date().toISOString() })
      .where(eq(stocktakeEvents.id, Number(eventId)))
      .run();

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

    db.update(stocktakeEvents)
      .set({ status, updatedAt: new Date().toISOString() })
      .where(eq(stocktakeEvents.id, Number(eventId)))
      .run();

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

    const event = db
      .select()
      .from(stocktakeEvents)
      .where(eq(stocktakeEvents.id, eid))
      .get();

    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    // Cascade delete all related data in correct order (children first)
    db.delete(auditLog).where(eq(auditLog.eventId, eid)).run();
    db.delete(breakdowns).where(eq(breakdowns.eventId, eid)).run();
    db.delete(queries).where(eq(queries.eventId, eid)).run();
    db.delete(counts).where(eq(counts.eventId, eid)).run();
    db.delete(teamAssignments).where(eq(teamAssignments.eventId, eid)).run();
    db.delete(items).where(eq(items.eventId, eid)).run();
    db.delete(supervisors).where(eq(supervisors.eventId, eid)).run();
    db.delete(teams).where(eq(teams.eventId, eid)).run();
    db.delete(stocktakeEvents).where(eq(stocktakeEvents.id, eid)).run();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete event error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
