import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getApiUser } from "@/lib/api-auth";
import { sql } from "drizzle-orm";

export async function GET(request: NextRequest) {
  const user = getApiUser(request);
  if (!user || user.type !== "supervisor") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const lastSeenQueries = searchParams.get("lastSeenQueries") || "1970-01-01T00:00:00Z";
  const lastSeenBreakdowns = searchParams.get("lastSeenBreakdowns") || "1970-01-01T00:00:00Z";
  const lastSeenSerials = searchParams.get("lastSeenSerials") || "1970-01-01T00:00:00Z";

  // Count open queries created since lastSeen
  const queriesCount = db.get<{ count: number }>(
    sql`SELECT COUNT(*) as count
        FROM queries
        WHERE event_id = ${user.eventId}
          AND status = 'open'
          AND created_at > ${lastSeenQueries}`
  );

  // Count pending breakdowns created since lastSeen
  const breakdownsCount = db.get<{ count: number }>(
    sql`SELECT COUNT(*) as count
        FROM breakdowns
        WHERE event_id = ${user.eventId}
          AND approval_status = 'pending'
          AND created_at > ${lastSeenBreakdowns}`
  );

  // Count open serial discrepancies created since lastSeen
  const serialsCount = db.get<{ count: number }>(
    sql`SELECT COUNT(*) as count
        FROM serial_discrepancies
        WHERE event_id = ${user.eventId}
          AND status = 'open'
          AND created_at > ${lastSeenSerials}`
  );

  return NextResponse.json({
    queries: queriesCount?.count ?? 0,
    breakdowns: breakdownsCount?.count ?? 0,
    serials: serialsCount?.count ?? 0,
  });
}
