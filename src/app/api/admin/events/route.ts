import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  stocktakeEvents, items, teams, supervisors,
  teamAssignments, counts, queries, queryMessages,
  breakdowns, breakdownMessages, verificationAssignments,
  auditLog, serialDiscrepancies,
} from "@/lib/db/schema";
import { eq, and, isNotNull, sql } from "drizzle-orm";

const VALID_STATUSES = ["setup", "active", "completed", "locked"] as const;

export async function GET() {
  const events = await db
    .select()
    .from(stocktakeEvents);

  const enriched = await Promise.all(events.map(async (event) => {
    const [totalItemCountRow] = await db
      .select({ count: sql<number>`count(*)` })
      .from(items)
      .where(eq(items.eventId, event.id));

    const [assignedItemCountRow] = await db
      .select({ count: sql<number>`count(*)` })
      .from(items)
      .where(and(eq(items.eventId, event.id), isNotNull(items.teamId)));

    const [teamCountRow] = await db
      .select({ count: sql<number>`count(*)` })
      .from(teams)
      .where(eq(teams.eventId, event.id));

    const [supervisorCountRow] = await db
      .select({ count: sql<number>`count(*)` })
      .from(supervisors)
      .where(eq(supervisors.eventId, event.id));

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

    // Cascade delete all related data (order matters for FK constraints)
    // 1. Messages (reference queries/breakdowns)
    const eventQueries = await db.select({ id: queries.id }).from(queries).where(eq(queries.eventId, eventId));
    if (eventQueries.length > 0) {
      const queryIds = eventQueries.map((q) => q.id);
      for (const qid of queryIds) {
        await db.delete(queryMessages).where(eq(queryMessages.queryId, qid));
      }
    }

    const eventBreakdowns = await db.select({ id: breakdowns.id }).from(breakdowns).where(eq(breakdowns.eventId, eventId));
    if (eventBreakdowns.length > 0) {
      const breakdownIds = eventBreakdowns.map((b) => b.id);
      for (const bid of breakdownIds) {
        await db.delete(breakdownMessages).where(eq(breakdownMessages.breakdownId, bid));
      }
    }

    // 2. Verification assignments, counts, queries, breakdowns, serial discrepancies
    await db.delete(verificationAssignments).where(eq(verificationAssignments.eventId, eventId));
    await db.delete(counts).where(eq(counts.eventId, eventId));
    await db.delete(queries).where(eq(queries.eventId, eventId));
    await db.delete(breakdowns).where(eq(breakdowns.eventId, eventId));
    await db.delete(serialDiscrepancies).where(eq(serialDiscrepancies.eventId, eventId));

    // 3. Team assignments, audit log
    await db.delete(teamAssignments).where(eq(teamAssignments.eventId, eventId));
    await db.delete(auditLog).where(eq(auditLog.eventId, eventId));

    // 4. Items (references teams via teamId, but that's nullable)
    await db.delete(items).where(eq(items.eventId, eventId));

    // 5. Supervisors and teams
    await db.delete(supervisors).where(eq(supervisors.eventId, eventId));
    await db.delete(teams).where(eq(teams.eventId, eventId));

    // 6. The event itself
    await db.delete(stocktakeEvents).where(eq(stocktakeEvents.id, eventId));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete event error:", error);
    return NextResponse.json(
      { error: "Failed to delete event" },
      { status: 500 }
    );
  }
}
