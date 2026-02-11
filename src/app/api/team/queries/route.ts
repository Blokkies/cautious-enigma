import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { queries, items, queryMessages, supervisors, auditLog } from "@/lib/db/schema";
import { eq, and, desc, asc, inArray } from "drizzle-orm";
import { getApiUser, checkEventActive } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
  const user = getApiUser(request);
  if (!user || user.type !== "team") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const teamQueries = db
    .select({
      id: queries.id,
      queryType: queries.queryType,
      message: queries.message,
      status: queries.status,
      createdAt: queries.createdAt,
      resolvedAt: queries.resolvedAt,
      itemCode: queries.itemCode,
      itemCodeResolved: items.itemCode,
      itemDescription: items.description,
    })
    .from(queries)
    .leftJoin(items, eq(queries.itemId, items.id))
    .where(
      and(eq(queries.teamId, user.id), eq(queries.eventId, user.eventId))
    )
    .orderBy(desc(queries.createdAt))
    .all();

  // Fetch messages for all queries
  const queryIds = teamQueries.map((q) => q.id);
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

    // Look up supervisor names for supervisor messages
    const supervisorIds = Array.from(new Set(
      allMsgs.filter((m) => m.senderType === "supervisor").map((m) => m.senderId)
    ));
    const supervisorNames: Record<number, string> = {};
    if (supervisorIds.length > 0) {
      const sups = db
        .select({ id: supervisors.id, name: supervisors.name })
        .from(supervisors)
        .where(and(inArray(supervisors.id, supervisorIds), eq(supervisors.eventId, user.eventId)))
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
          : "You",
        message: m.message,
        createdAt: m.createdAt,
      });
    }
  }

  const enriched = teamQueries.map(({ itemCodeResolved, ...q }) => ({
    ...q,
    itemCode: q.itemCode || itemCodeResolved || null,
    messages: messagesMap[q.id] || [],
  }));

  return NextResponse.json({ queries: enriched });
}

export async function POST(request: NextRequest) {
  const user = getApiUser(request);
  if (!user || user.type !== "team") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const lockError = checkEventActive(user.eventId);
  if (lockError) {
    return NextResponse.json({ error: lockError }, { status: 403 });
  }

  try {
    const { queryType, message, itemId } = await request.json();

    if (!queryType || !message) {
      return NextResponse.json(
        { error: "queryType and message are required" },
        { status: 400 }
      );
    }

    // If itemId is an item code string, look it up
    let resolvedItemId: number | null = null;
    if (itemId) {
      const item = db
        .select({ id: items.id })
        .from(items)
        .where(
          and(
            eq(items.itemCode, String(itemId)),
            eq(items.eventId, user.eventId)
          )
        )
        .get();
      resolvedItemId = item?.id || null;
    }

    const result = db
      .insert(queries)
      .values({
        eventId: user.eventId,
        teamId: user.id,
        itemId: resolvedItemId,
        itemCode: itemId ? String(itemId) : null,
        queryType,
        message,
        status: "open",
      })
      .run();

    return NextResponse.json({
      success: true,
      id: Number(result.lastInsertRowid),
    });
  } catch (error) {
    console.error("Query creation error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// Team sends a message in the conversation
export async function PATCH(request: NextRequest) {
  const user = getApiUser(request);
  if (!user || user.type !== "team") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const lockError = checkEventActive(user.eventId);
  if (lockError) {
    return NextResponse.json({ error: lockError }, { status: 403 });
  }

  try {
    const { queryId, message } = await request.json();

    if (!queryId || !message?.trim()) {
      return NextResponse.json(
        { error: "queryId and message are required" },
        { status: 400 }
      );
    }

    // Verify the query belongs to this team and is open
    const query = db
      .select({ id: queries.id, teamId: queries.teamId, status: queries.status })
      .from(queries)
      .where(
        and(eq(queries.id, queryId), eq(queries.eventId, user.eventId))
      )
      .get();

    if (!query || query.teamId !== user.id) {
      return NextResponse.json({ error: "Query not found" }, { status: 404 });
    }

    if (query.status !== "open") {
      return NextResponse.json(
        { error: "Query is not open" },
        { status: 400 }
      );
    }

    db.insert(queryMessages)
      .values({
        queryId,
        senderType: "team",
        senderId: user.id,
        message: message.trim(),
      })
      .run();

    db.insert(auditLog)
      .values({
        eventId: user.eventId,
        userId: user.id,
        userType: "team",
        action: "query_team_message",
        tableName: "query_messages",
        recordId: queryId,
        newValue: JSON.stringify({ message: message.trim() }),
      })
      .run();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Team message error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
