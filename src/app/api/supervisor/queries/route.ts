import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { queries, teams, items, queryMessages, supervisors, auditLog } from "@/lib/db/schema";
import { eq, and, desc, asc, inArray } from "drizzle-orm";
import { getApiUser, checkEventActive } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
  const user = getApiUser(request);
  if (!user || user.type !== "supervisor") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const allQueries = db
    .select({
      id: queries.id,
      queryType: queries.queryType,
      message: queries.message,
      status: queries.status,
      createdAt: queries.createdAt,
      resolvedAt: queries.resolvedAt,
      teamName: teams.name,
      teamMember1: teams.member1,
      teamMember2: teams.member2,
      itemCode: queries.itemCode,
      itemCodeResolved: items.itemCode,
      itemDescription: items.description,
    })
    .from(queries)
    .innerJoin(teams, eq(queries.teamId, teams.id))
    .leftJoin(items, eq(queries.itemId, items.id))
    .where(eq(queries.eventId, user.eventId))
    .orderBy(desc(queries.createdAt))
    .all();

  // Fetch messages for all queries
  const queryIds = allQueries.map((q) => q.id);
  // Build team name lookup from query data
  const teamNameByQueryId: Record<number, string> = {};
  for (const q of allQueries) {
    teamNameByQueryId[q.id] = q.teamName;
  }

  const messagesMap: Record<number, { senderType: string; senderName: string; message: string; createdAt: string }[]> = {};

  if (queryIds.length > 0) {
    const allMsgs = db
      .select({
        queryId: queryMessages.queryId,
        senderType: queryMessages.senderType,
        senderId: queryMessages.senderId,
        message: queryMessages.message,
        createdAt: queryMessages.createdAt,
      })
      .from(queryMessages)
      .where(inArray(queryMessages.queryId, queryIds))
      .orderBy(asc(queryMessages.createdAt))
      .all();

    // Look up supervisor names
    const supervisorIds = Array.from(new Set(
      allMsgs.filter((m) => m.senderType === "supervisor").map((m) => m.senderId)
    ));
    const supervisorNames: Record<number, string> = {};
    if (supervisorIds.length > 0) {
      const sups = db
        .select({ id: supervisors.id, name: supervisors.name })
        .from(supervisors)
        .where(inArray(supervisors.id, supervisorIds))
        .all();
      for (const s of sups) {
        supervisorNames[s.id] = s.name;
      }
    }

    for (const m of allMsgs) {
      if (!messagesMap[m.queryId]) messagesMap[m.queryId] = [];
      messagesMap[m.queryId].push({
        senderType: m.senderType,
        senderName: m.senderType === "supervisor"
          ? supervisorNames[m.senderId] || "Supervisor"
          : teamNameByQueryId[m.queryId] || "Team",
        message: m.message,
        createdAt: m.createdAt,
      });
    }
  }

  const enriched = allQueries.map(({ itemCodeResolved, ...q }) => ({
    ...q,
    itemCode: q.itemCode || itemCodeResolved || null,
    messages: messagesMap[q.id] || [],
  }));

  return NextResponse.json({ queries: enriched });
}

// Respond to a query
export async function POST(request: NextRequest) {
  const user = getApiUser(request);
  if (!user || user.type !== "supervisor") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const lockError = checkEventActive(user.eventId);
  if (lockError) {
    return NextResponse.json({ error: lockError }, { status: 403 });
  }

  try {
    const { queryId, response, status } = await request.json();

    if (!queryId) {
      return NextResponse.json(
        { error: "queryId is required" },
        { status: 400 }
      );
    }

    // If a response text was provided, add it as a message
    if (response) {
      db.insert(queryMessages)
        .values({
          queryId,
          senderType: "supervisor",
          senderId: user.id,
          message: response,
        })
        .run();
    }

    const updateData: Record<string, unknown> = {
      respondedBy: user.id,
    };

    // If status is explicitly set to resolved, close the query
    if (status === "resolved") {
      updateData.status = "resolved";
      updateData.resolvedAt = new Date().toISOString();
    } else if (status === "open") {
      updateData.status = "open";
      updateData.resolvedAt = null;
    }

    db.update(queries)
      .set(updateData)
      .where(eq(queries.id, queryId))
      .run();

    // Audit log
    const auditAction =
      status === "resolved"
        ? "query_resolved"
        : status === "open" && !response
          ? "query_reopened"
          : "query_responded";

    db.insert(auditLog)
      .values({
        eventId: user.eventId,
        userId: user.id,
        userType: "supervisor",
        action: auditAction,
        tableName: "queries",
        recordId: queryId,
        newValue: JSON.stringify({
          ...(response ? { response } : {}),
          status: status || "open",
        }),
      })
      .run();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Query response error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// Delete a query
export async function DELETE(request: NextRequest) {
  const user = getApiUser(request);
  if (!user || user.type !== "supervisor") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { queryId } = await request.json();

    if (!queryId) {
      return NextResponse.json(
        { error: "queryId is required" },
        { status: 400 }
      );
    }

    // Verify the query belongs to this event
    const query = db
      .select({ id: queries.id })
      .from(queries)
      .where(and(eq(queries.id, queryId), eq(queries.eventId, user.eventId)))
      .get();

    if (!query) {
      return NextResponse.json({ error: "Query not found" }, { status: 404 });
    }

    // Delete messages first (foreign key)
    db.delete(queryMessages).where(eq(queryMessages.queryId, queryId)).run();
    // Delete the query
    db.delete(queries).where(eq(queries.id, queryId)).run();

    // Audit log
    db.insert(auditLog)
      .values({
        eventId: user.eventId,
        userId: user.id,
        userType: "supervisor",
        action: "query_deleted",
        tableName: "queries",
        recordId: queryId,
      })
      .run();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Query delete error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
