import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { teams } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getApiUser } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
  const user = getApiUser(request);
  if (!user || user.type !== "supervisor") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const eventTeams = await db
    .select({
      id: teams.id,
      name: teams.name,
      member1: teams.member1,
      member2: teams.member2,
    })
    .from(teams)
    .where(eq(teams.eventId, user.eventId));

  return NextResponse.json({ teams: eventTeams });
}
