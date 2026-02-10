import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { teams, supervisors, stocktakeEvents } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function GET(request: NextRequest) {
  const type = request.nextUrl.searchParams.get("type");

  // Find active event (or latest setup event for login list)
  const activeEvent = db
    .select()
    .from(stocktakeEvents)
    .where(eq(stocktakeEvents.status, "active"))
    .get();

  const setupEvent = activeEvent || db
    .select()
    .from(stocktakeEvents)
    .where(eq(stocktakeEvents.status, "setup"))
    .get();

  if (!setupEvent) {
    return NextResponse.json({ items: [] });
  }

  if (type === "team") {
    const teamList = db
      .select({ id: teams.id, name: teams.name })
      .from(teams)
      .where(eq(teams.eventId, setupEvent.id))
      .all();
    return NextResponse.json({ items: teamList });
  }

  if (type === "supervisor") {
    const supervisorList = db
      .select({ id: supervisors.id, name: supervisors.name })
      .from(supervisors)
      .where(eq(supervisors.eventId, setupEvent.id))
      .all();
    return NextResponse.json({ items: supervisorList });
  }

  return NextResponse.json({ items: [] });
}
