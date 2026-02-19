import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { supervisors, stocktakeEvents } from "@/lib/db/schema";
import { inArray } from "drizzle-orm";
import { getApiUser } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
  const user = getApiUser(request);
  if (!user || (user.type !== "executive" && user.type !== "admin")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Get active events
  const activeEvents = await db
    .select({ id: stocktakeEvents.id, name: stocktakeEvents.name })
    .from(stocktakeEvents)
    .where(inArray(stocktakeEvents.status, ["active", "completed"]));

  if (activeEvents.length === 0) {
    return NextResponse.json({ groups: [] });
  }

  const eventIds = activeEvents.map((e) => e.id);
  const allSupervisors = await db
    .select({
      id: supervisors.id,
      name: supervisors.name,
      eventId: supervisors.eventId,
    })
    .from(supervisors)
    .where(inArray(supervisors.eventId, eventIds));

  const eventMap = new Map(activeEvents.map((e) => [e.id, e.name]));

  const groups = activeEvents.map((event) => ({
    eventId: event.id,
    eventName: event.name,
    supervisors: allSupervisors
      .filter((s) => s.eventId === event.id)
      .map((s) => ({ id: s.id, name: s.name })),
  })).filter((g) => g.supervisors.length > 0);

  return NextResponse.json({ groups });
}
