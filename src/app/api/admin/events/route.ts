import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { stocktakeEvents, items, teams, supervisors } from "@/lib/db/schema";
import { eq, and, isNotNull, sql } from "drizzle-orm";

const VALID_STATUSES = ["setup", "active", "completed", "locked"] as const;

export async function GET() {
  const events = db
    .select()
    .from(stocktakeEvents)
    .all();

  const enriched = events.map((event) => {
    const totalItemCount = db
      .select({ count: sql<number>`count(*)` })
      .from(items)
      .where(eq(items.eventId, event.id))
      .get();

    const assignedItemCount = db
      .select({ count: sql<number>`count(*)` })
      .from(items)
      .where(and(eq(items.eventId, event.id), isNotNull(items.teamId)))
      .get();

    const teamCount = db
      .select({ count: sql<number>`count(*)` })
      .from(teams)
      .where(eq(teams.eventId, event.id))
      .get();

    const supervisorCount = db
      .select({ count: sql<number>`count(*)` })
      .from(supervisors)
      .where(eq(supervisors.eventId, event.id))
      .get();

    return {
      ...event,
      itemCount: assignedItemCount?.count || 0,
      totalItemCount: totalItemCount?.count || 0,
      teamCount: teamCount?.count || 0,
      supervisorCount: supervisorCount?.count || 0,
    };
  });

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

    const result = db
      .insert(stocktakeEvents)
      .values({
        name,
        location: location || null,
        startDate: startDate || null,
        endDate: endDate || null,
        status: "setup",
      })
      .run();

    return NextResponse.json({
      success: true,
      id: Number(result.lastInsertRowid),
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
    const { id, status } = await request.json();

    if (!id || !status) {
      return NextResponse.json(
        { error: "Missing id or status" },
        { status: 400 }
      );
    }

    if (!VALID_STATUSES.includes(status)) {
      return NextResponse.json(
        { error: `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}` },
        { status: 400 }
      );
    }

    const existing = db
      .select()
      .from(stocktakeEvents)
      .where(eq(stocktakeEvents.id, Number(id)))
      .get();

    if (!existing) {
      return NextResponse.json(
        { error: "Event not found" },
        { status: 404 }
      );
    }

    db.update(stocktakeEvents)
      .set({ status, updatedAt: new Date().toISOString() })
      .where(eq(stocktakeEvents.id, Number(id)))
      .run();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Update event status error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
