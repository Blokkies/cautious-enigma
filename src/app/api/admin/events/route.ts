import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  stocktakeEvents, items, teams, supervisors,
  teamAssignments, counts, queries, queryMessages,
  breakdowns, breakdownMessages, verificationAssignments,
  auditLog, serialDiscrepancies, execMessages,
} from "@/lib/db/schema";
import { eq, and, isNotNull, sql } from "drizzle-orm";
import { getApiUser } from "@/lib/api-auth";

const VALID_STATUSES = ["setup", "active", "completed", "locked"] as const;

export async function GET(request: NextRequest) {
  const user = getApiUser(request);
  if (!user || user.type !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const events = await db
    .select()
    .from(stocktakeEvents);

  const enriched = await Promise.all(events.map(async (event) => {
    const [[totalItemCountRow], [assignedItemCountRow], [teamCountRow], [supervisorCountRow]] = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(items).where(eq(items.eventId, event.id)),
      db.select({ count: sql<number>`count(*)` }).from(items).where(and(eq(items.eventId, event.id), isNotNull(items.teamId))),
      db.select({ count: sql<number>`count(*)` }).from(teams).where(eq(teams.eventId, event.id)),
      db.select({ count: sql<number>`count(*)` }).from(supervisors).where(eq(supervisors.eventId, event.id)),
    ]);

    return {
      ...event,
      itemCount: assignedItemCountRow?.count || 0,
      totalItemCount: totalItemCountRow?.count || 0,
      teamCount: teamCountRow?.count || 0,
      supervisorCount: supervisorCountRow?.count || 0,
    };
  }));

  return NextResponse.json({ events: enriched });
}

export async function POST(request: NextRequest) {
  const user = getApiUser(request);
  if (!user || user.type !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  try {
    const { name, location, startDate, endDate } = await request.json();

    if (!name) {
      return NextResponse.json(
        { error: "Event name is required" },
        { status: 400 }
      );
    }

    const [result] = await db
      .insert(stocktakeEvents)
      .values({
        name,
        location: location || null,
        startDate: startDate || null,
        endDate: endDate || null,
        status: "setup",
      })
      .returning({ id: stocktakeEvents.id });

    return NextResponse.json({
      success: true,
      id: result.id,
    });
  } catch (error) {
    console.error("Create event error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  const user = getApiUser(request);
  if (!user || user.type !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { id, status, warehouses } = body;

    if (!id) {
      return NextResponse.json(
        { error: "Missing id" },
        { status: 400 }
      );
    }

    const [existing] = await db
      .select()
      .from(stocktakeEvents)
      .where(eq(stocktakeEvents.id, Number(id)));

    if (!existing) {
      return NextResponse.json(
        { error: "Event not found" },
        { status: 404 }
      );
    }

    const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };

    if (status) {
      if (!VALID_STATUSES.includes(status)) {
        return NextResponse.json(
          { error: `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}` },
          { status: 400 }
        );
      }
      updates.status = status;
    }

    if (warehouses !== undefined) {
      updates.warehouses = Array.isArray(warehouses) ? JSON.stringify(warehouses) : null;
    }

    await db.update(stocktakeEvents)
      .set(updates)
      .where(eq(stocktakeEvents.id, Number(id)));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Update event error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const user = getApiUser(request);
  if (!user || user.type !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  try {
    const { id } = await request.json();

    if (!id) {
      return NextResponse.json({ error: "Missing id" }, { status: 400 });
    }

    const eventId = Number(id);

    const [existing] = await db
      .select()
      .from(stocktakeEvents)
      .where(eq(stocktakeEvents.id, eventId));

    if (!existing) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    // Cascade delete all related data in a transaction for atomicity
    await db.transaction(async (tx) => {
      // 1. Messages (use subquery to avoid N+1)
      await tx.delete(queryMessages).where(sql`query_id IN (SELECT id FROM queries WHERE event_id = ${eventId})`);
      await tx.delete(breakdownMessages).where(sql`breakdown_id IN (SELECT id FROM breakdowns WHERE event_id = ${eventId})`);
      await tx.delete(execMessages).where(eq(execMessages.eventId, eventId));

      // 2. Verification assignments, counts, queries, breakdowns, serial discrepancies
      await tx.delete(verificationAssignments).where(eq(verificationAssignments.eventId, eventId));
      await tx.delete(counts).where(eq(counts.eventId, eventId));
      await tx.delete(queries).where(eq(queries.eventId, eventId));
      await tx.delete(breakdowns).where(eq(breakdowns.eventId, eventId));
      await tx.delete(serialDiscrepancies).where(eq(serialDiscrepancies.eventId, eventId));

      // 3. Team assignments, audit log
      await tx.delete(teamAssignments).where(eq(teamAssignments.eventId, eventId));
      await tx.delete(auditLog).where(eq(auditLog.eventId, eventId));

      // 4. Items
      await tx.delete(items).where(eq(items.eventId, eventId));

      // 5. Supervisors and teams (exec_messages refs supervisors, already deleted above)
      await tx.delete(supervisors).where(eq(supervisors.eventId, eventId));
      await tx.delete(teams).where(eq(teams.eventId, eventId));

      // 6. Clear upload_id reference, then delete the event
      await tx.update(stocktakeEvents).set({ uploadId: null }).where(eq(stocktakeEvents.id, eventId));
      await tx.delete(stocktakeEvents).where(eq(stocktakeEvents.id, eventId));
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete event error:", error);
    return NextResponse.json(
      { error: "Failed to delete event" },
      { status: 500 }
    );
  }
}
