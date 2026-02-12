import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getApiUser } from "@/lib/api-auth";
import { sql } from "drizzle-orm";

export async function GET(request: NextRequest) {
  const user = getApiUser(request);
  if (!user || user.type !== "team") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const lastSeenQueries = searchParams.get("lastSeenQueries") || "1970-01-01T00:00:00Z";
  const lastSeenBreakdowns = searchParams.get("lastSeenBreakdowns") || "1970-01-01T00:00:00Z";
  const lastSeenVerifications = searchParams.get("lastSeenVerifications") || "1970-01-01T00:00:00Z";

  // Count queries with new supervisor messages since lastSeen
  const queriesResult = await db.execute(
    sql`SELECT COUNT(DISTINCT qm.query_id) as count
        FROM query_messages qm
        INNER JOIN queries q ON q.id = qm.query_id
        WHERE q.team_id = ${user.id}
          AND q.event_id = ${user.eventId}
          AND qm.sender_type = 'supervisor'
          AND qm.created_at > ${lastSeenQueries}`
  );
  const queriesCountVal = Number((queriesResult[0] as Record<string, unknown>)?.count ?? 0);

  // Count breakdowns with new supervisor messages or status changes since lastSeen
  const breakdownsResult = await db.execute(
    sql`SELECT COUNT(*) as count FROM (
          SELECT DISTINCT bm.breakdown_id as id
          FROM breakdown_messages bm
          INNER JOIN breakdowns b ON b.id = bm.breakdown_id
          WHERE b.team_id = ${user.id}
            AND b.event_id = ${user.eventId}
            AND bm.sender_type = 'supervisor'
            AND bm.created_at > ${lastSeenBreakdowns}
          UNION
          SELECT id
          FROM breakdowns
          WHERE team_id = ${user.id}
            AND event_id = ${user.eventId}
            AND resolved_at IS NOT NULL
            AND resolved_at > ${lastSeenBreakdowns}
        ) AS combined`
  );
  const breakdownsCountVal = Number((breakdownsResult[0] as Record<string, unknown>)?.count ?? 0);

  // Count pending verification assignments created since lastSeen
  const verificationsResult = await db.execute(
    sql`SELECT COUNT(*) as count
        FROM verification_assignments
        WHERE assigned_team_id = ${user.id}
          AND event_id = ${user.eventId}
          AND status = 'pending'
          AND assigned_at > ${lastSeenVerifications}`
  );
  const verificationsCountVal = Number((verificationsResult[0] as Record<string, unknown>)?.count ?? 0);

  return NextResponse.json({
    queries: queriesCountVal,
    breakdowns: breakdownsCountVal,
    verifications: verificationsCountVal,
  });
}
