import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { queries, items } from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";
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
      response: queries.response,
      status: queries.status,
      createdAt: queries.createdAt,
      resolvedAt: queries.resolvedAt,
      itemCode: items.itemCode,
      itemDescription: items.description,
    })
    .from(queries)
    .leftJoin(items, eq(queries.itemId, items.id))
    .where(
      and(eq(queries.teamId, user.id), eq(queries.eventId, user.eventId))
    )
    .orderBy(desc(queries.createdAt))
    .all();

  return NextResponse.json({ queries: teamQueries });
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
