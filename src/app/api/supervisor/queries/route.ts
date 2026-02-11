import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { queries, teams, items } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
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
      response: queries.response,
      status: queries.status,
      createdAt: queries.createdAt,
      resolvedAt: queries.resolvedAt,
      teamName: teams.name,
      itemCode: items.itemCode,
    })
    .from(queries)
    .innerJoin(teams, eq(queries.teamId, teams.id))
    .leftJoin(items, eq(queries.itemId, items.id))
    .where(eq(queries.eventId, user.eventId))
    .orderBy(desc(queries.createdAt))
    .all();

  return NextResponse.json({ queries: allQueries });
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

    const updateData: Record<string, unknown> = {
      respondedBy: user.id,
    };

    // If a response text was provided, update it
    if (response) {
      updateData.response = response;
    }

    // If status is explicitly set to resolved, close the query
    if (status === "resolved") {
      updateData.status = "resolved";
      updateData.resolvedAt = new Date().toISOString();
    }
    // Otherwise keep it open (status stays unchanged)

    db.update(queries)
      .set(updateData)
      .where(eq(queries.id, queryId))
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
