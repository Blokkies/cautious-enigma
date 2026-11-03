import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { stocktakeEvents, items, teams, supervisors } from "@/lib/db/schema";
import { eq, and, isNotNull } from "drizzle-orm";
import { requireUser } from "@/lib/api-auth";
import { EVENT_STATUSES as VALID_STATUSES, checkEventsPutTransition } from "@/lib/event-status";
import { countInt } from "@/lib/db/aggregates";
import { deleteEventCascade } from "./delete-event";

export async function GET(request: NextRequest) {
  const auth = await requireUser(request, { roles: ["admin"] });
  if (auth.response) return auth.response;

  const events = await db
    .select()
    .from(stocktakeEvents);

  const enriched = await Promise.all(events.map(async (event) => {
    const [[totalItemCountRow], [assignedItemCountRow], [teamCountRow], [supervisorCountRow]] = await Promise.all([
      db.select({ count: countInt() }).from(items).where(eq(items.eventId, event.id)),
      db.select({ count: countInt() }).from(items).where(and(eq(items.eventId, event.id), isNotNull(items.teamId))),
      db.select({ count: countInt() }).from(teams).where(eq(teams.eventId, event.id)),
      db.select({ count: countInt() }).from(supervisors).where(eq(supervisors.eventId, event.id)),
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
  const auth = await requireUser(request, { roles: ["admin"], write: true });
  if (auth.response) return auth.response;

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
  const auth = await requireUser(request, { roles: ["admin"], write: true });
  if (auth.response) return auth.response;

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
      // setup -> active must go through POST /api/admin/activate.
      const transition = checkEventsPutTransition(existing.status, status);
      if (!transition.ok) {
        return NextResponse.json({ error: transition.error }, { status: 400 });
      }
      if (transition.changed) {
        updates.status = status;
      }
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
  const auth = await requireUser(request, { roles: ["admin"], write: true });
  if (auth.response) return auth.response;

  try {
    const { id } = await request.json();

    if (!id) {
      return NextResponse.json({ error: "Missing id" }, { status: 400 });
    }

    return await deleteEventCascade(Number(id));
  } catch (error) {
    console.error("Delete event error:", error);
    return NextResponse.json(
      { error: "Failed to delete event" },
      { status: 500 }
    );
  }
}
