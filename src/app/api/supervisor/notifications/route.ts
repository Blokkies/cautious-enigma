import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getApiUser } from "@/lib/api-auth";
import { sql } from "drizzle-orm";

export async function GET(request: NextRequest) {
  const user = getApiUser(request);
  if (!user || (user.type !== "supervisor" && user.type !== "auditor")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const lastSeenQueries = searchParams.get("lastSeenQueries") || "1970-01-01T00:00:00Z";
  const lastSeenBreakdowns = searchParams.get("lastSeenBreakdowns") || "1970-01-01T00:00:00Z";
  const lastSeenSerials = searchParams.get("lastSeenSerials") || "1970-01-01T00:00:00Z";
  const lastSeenExecMessages = searchParams.get("lastSeenExecMessages") || "1970-01-01T00:00:00Z";

  // Count open queries that have new team messages since lastSeen,
  // UNION with brand-new open queries created since lastSeen
  const queriesResult = await db.execute(
    sql`SELECT COUNT(*) as count FROM (
          SELECT DISTINCT qm.query_id as id
          FROM query_messages qm
          INNER JOIN queries q ON q.id = qm.query_id
          WHERE q.event_id = ${user.eventId}
            AND q.status = 'open'
            AND qm.sender_type = 'team'
            AND qm.created_at > ${lastSeenQueries}
          UNION
          SELECT id
          FROM queries
          WHERE event_id = ${user.eventId}
            AND status = 'open'
            AND created_at > ${lastSeenQueries}
        ) AS combined`
  );
  const queriesCountVal = Number((queriesResult[0] as Record<string, unknown>)?.count ?? 0);

  // Count pending breakdowns that have new team messages since lastSeen,
  // UNION with brand-new pending breakdowns created since lastSeen
  const breakdownsResult = await db.execute(
    sql`SELECT COUNT(*) as count FROM (
          SELECT DISTINCT bm.breakdown_id as id
          FROM breakdown_messages bm
          INNER JOIN breakdowns b ON b.id = bm.breakdown_id
          WHERE b.event_id = ${user.eventId}
            AND b.approval_status = 'pending'
            AND bm.sender_type = 'team'
            AND bm.created_at > ${lastSeenBreakdowns}
          UNION
          SELECT id
          FROM breakdowns
          WHERE event_id = ${user.eventId}
            AND approval_status = 'pending'
            AND created_at > ${lastSeenBreakdowns}
        ) AS combined`
  );
  const breakdownsCountVal = Number((breakdownsResult[0] as Record<string, unknown>)?.count ?? 0);

  // Count open serial discrepancies created since lastSeen
  const serialsResult = await db.execute(
    sql`SELECT COUNT(*) as count
        FROM serial_discrepancies
        WHERE event_id = ${user.eventId}
          AND status = 'open'
          AND created_at > ${lastSeenSerials}`
  );
  const serialsCountVal = Number((serialsResult[0] as Record<string, unknown>)?.count ?? 0);

  // Count exec messages from executives/admins since lastSeen
  // Use two strategies: lastSeen-based AND "awaiting reply" (last message is from exec/admin)
  const execMessagesResult = await db.execute(
    sql`SELECT COUNT(*) as count
        FROM exec_messages
        WHERE supervisor_id = ${user.id}
          AND sender_type IN ('executive', 'admin')
          AND created_at > ${lastSeenExecMessages}`
  );
  const execMessagesLastSeenCount = Number((execMessagesResult[0] as Record<string, unknown>)?.count ?? 0);

  // Also check if the most recent message in any thread is from an exec/admin (awaiting reply)
  const awaitingReplyResult = await db.execute(
    sql`SELECT COUNT(*) as count FROM exec_messages em1
        WHERE em1.supervisor_id = ${user.id}
          AND em1.sender_type IN ('executive', 'admin')
          AND em1.id = (
            SELECT id FROM exec_messages em2
            WHERE em2.supervisor_id = em1.supervisor_id
            ORDER BY em2.created_at DESC LIMIT 1
          )`
  );
  const awaitingReplyCount = Number((awaitingReplyResult[0] as Record<string, unknown>)?.count ?? 0);

  // Use the higher of the two — ensures banner shows even if lastSeen timestamp was set
  const execMessagesCountVal = Math.max(execMessagesLastSeenCount, awaitingReplyCount);

  return NextResponse.json({
    queries: queriesCountVal,
    breakdowns: breakdownsCountVal,
    serials: serialsCountVal,
    execMessages: execMessagesCountVal,
  });
}
