import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { stocktakeEvents, items, teams, supervisors } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";

export async function GET() {
  const events = db
    .select()
    .from(stocktakeEvents)
    .all();

  const enriched = events.map((event) => {
    const itemCount = db
      .select({ count: sql<number>`count(*)` })
      .from(items)
      .where(eq(items.eventId, event.id))
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
      itemCount: itemCount?.count || 0,
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
