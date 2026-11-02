import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { teams } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireUser, resolveEventId } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
  const auth = await requireUser(request, { roles: ["supervisor", "auditor", "executive"], status: 401 });
  if (auth.response) return auth.response;
  const { user } = auth;

  // Admins/executives log in with eventId 0 and pick the event via ?eventId
  const eventId = resolveEventId(user, request.nextUrl.searchParams.get("eventId"));
  if (!eventId) {
    return NextResponse.json({ error: "eventId is required" }, { status: 400 });
  }

  const eventTeams = await db
    .select({
      id: teams.id,
      name: teams.name,
      members: teams.members,
    })
    .from(teams)
    .where(eq(teams.eventId, eventId));

  return NextResponse.json({ teams: eventTeams });
}
