import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { stocktakeEvents, items, teams, supervisors, counts, queries, queryMessages, breakdowns, breakdownMessages, teamAssignments, auditLog, verificationAssignments, serialDiscrepancies } from "@/lib/db/schema";
import { eq, and, sql, isNull } from "drizzle-orm";
import { getApiUser } from "@/lib/api-auth";

// GET: Check readiness
export async function GET(request: NextRequest) {
  const user = getApiUser(request);
  if (!user || user.type !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const eventId = request.nextUrl.searchParams.get("eventId");
  if (!eventId) {
    return NextResponse.json({ error: "eventId required" }, { status: 400 });
  }

  const eid = Number(eventId);

  const [[itemCount], [teamCount], [supervisorCount], [unassignedCount]] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(items).where(eq(items.eventId, eid)),
    db.select({ count: sql<number>`count(*)` }).from(teams).where(eq(teams.eventId, eid)),
    db.select({ count: sql<number>`count(*)` }).from(supervisors).where(eq(supervisors.eventId, eid)),
    db.select({ count: sql<number>`count(*)` }).from(items).where(and(eq(items.eventId, eid), isNull(items.teamId))),
  ]);

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
  const user = getApiUser(request);
  if (!user || user.type !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

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

// PUT: Change status (complete/lock/setup) or reset stocktake
export async function PUT(request: NextRequest) {
  const user = getApiUser(request);
  if (!user || user.type !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  try {
    const { eventId, status, action } = await request.json();
    const eid = Number(eventId);

    // Full reset: delete all operational data but keep imported items and event
    if (action === "reset") {
      await db.transaction(async (tx) => {
        // Delete operational data in correct order (children first)
        await tx.delete(verificationAssignments).where(eq(verificationAssignments.eventId, eid));
        await tx.delete(auditLog).where(eq(auditLog.eventId, eid));
        await tx.delete(serialDiscrepancies).where(eq(serialDiscrepancies.eventId, eid));
        await tx.delete(breakdownMessages).where(sql`breakdown_id IN (SELECT id FROM breakdowns WHERE event_id = ${eid})`);
        await tx.delete(breakdowns).where(eq(breakdowns.eventId, eid));
        await tx.delete(queryMessages).where(sql`query_id IN (SELECT id FROM queries WHERE event_id = ${eid})`);
        await tx.delete(queries).where(eq(queries.eventId, eid));
        await tx.delete(counts).where(eq(counts.eventId, eid));
        await tx.delete(teamAssignments).where(eq(teamAssignments.eventId, eid));
        // Clear bin assignments but keep items
        await tx.update(items).set({ teamId: null }).where(eq(items.eventId, eid));
        // Delete teams and supervisors
        await tx.delete(supervisors).where(eq(supervisors.eventId, eid));
        await tx.delete(teams).where(eq(teams.eventId, eid));
        // Reset status to setup
        await tx.update(stocktakeEvents)
          .set({ status: "setup", updatedAt: new Date().toISOString() })
          .where(eq(stocktakeEvents.id, eid));
      });

      return NextResponse.json({ success: true });
    }

    if (!["setup", "completed", "locked"].includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    await db.update(stocktakeEvents)
      .set({ status, updatedAt: new Date().toISOString() })
      .where(eq(stocktakeEvents.id, eid));

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
  const user = getApiUser(request);
  if (!user || user.type !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

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

    // Cascade delete all related data in a transaction for atomicity
    await db.transaction(async (tx) => {
      await tx.delete(verificationAssignments).where(eq(verificationAssignments.eventId, eid));
      await tx.delete(auditLog).where(eq(auditLog.eventId, eid));
      await tx.delete(serialDiscrepancies).where(eq(serialDiscrepancies.eventId, eid));
      await tx.delete(breakdownMessages).where(sql`breakdown_id IN (SELECT id FROM breakdowns WHERE event_id = ${eid})`);
      await tx.delete(breakdowns).where(eq(breakdowns.eventId, eid));
      await tx.delete(queryMessages).where(sql`query_id IN (SELECT id FROM queries WHERE event_id = ${eid})`);
      await tx.delete(queries).where(eq(queries.eventId, eid));
      await tx.delete(counts).where(eq(counts.eventId, eid));
      await tx.delete(teamAssignments).where(eq(teamAssignments.eventId, eid));
      await tx.delete(items).where(eq(items.eventId, eid));
      await tx.delete(supervisors).where(eq(supervisors.eventId, eid));
      await tx.delete(teams).where(eq(teams.eventId, eid));
      await tx.delete(stocktakeEvents).where(eq(stocktakeEvents.id, eid));
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete event error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
