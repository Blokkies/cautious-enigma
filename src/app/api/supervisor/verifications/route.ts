import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { counts, verificationAssignments, items, teams, auditLog } from "@/lib/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { getApiUser } from "@/lib/api-auth";

export async function POST(request: NextRequest) {
  const user = getApiUser(request);
  if (!user || user.type !== "supervisor") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { countIds, assignedTeamId } = await request.json();

    if (!Array.isArray(countIds) || countIds.length === 0 || !assignedTeamId) {
      return NextResponse.json(
        { error: "countIds (array) and assignedTeamId are required" },
        { status: 400 }
      );
    }

    // Validate team belongs to this event
    const team = db
      .select({ id: teams.id })
      .from(teams)
      .where(and(eq(teams.id, assignedTeamId), eq(teams.eventId, user.eventId)))
      .get();

    if (!team) {
      return NextResponse.json(
        { error: "Team not found in this event" },
        { status: 404 }
      );
    }

    // Fetch the counts and validate
    const targetCounts = db
      .select({
        id: counts.id,
        itemId: counts.itemId,
        eventId: counts.eventId,
        isMatch: counts.isMatch,
      })
      .from(counts)
      .where(and(inArray(counts.id, countIds), eq(counts.eventId, user.eventId)))
      .all();

    if (targetCounts.length === 0) {
      return NextResponse.json(
        { error: "No valid counts found" },
        { status: 404 }
      );
    }

    // Validate all counts belong to this event and have variances
    for (const c of targetCounts) {
      if (c.eventId !== user.eventId) {
        return NextResponse.json(
          { error: `Count ${c.id} does not belong to this event` },
          { status: 403 }
        );
      }
      if (c.isMatch) {
        return NextResponse.json(
          { error: `Count ${c.id} has no variance (is a match)` },
          { status: 400 }
        );
      }
    }

    // Check no existing pending verification for the same items
    const itemIds = targetCounts.map((c) => c.itemId);
    const existingVerifications = db
      .select({ itemId: verificationAssignments.itemId })
      .from(verificationAssignments)
      .where(
        and(
          inArray(verificationAssignments.itemId, itemIds),
          eq(verificationAssignments.eventId, user.eventId),
          eq(verificationAssignments.status, "pending")
        )
      )
      .all();

    if (existingVerifications.length > 0) {
      const existingItemIds = existingVerifications.map((v) => v.itemId);
      return NextResponse.json(
        {
          error: `Pending verification already exists for item(s): ${existingItemIds.join(", ")}`,
        },
        { status: 409 }
      );
    }

    // Insert verification assignments
    const created: number[] = [];
    for (const c of targetCounts) {
      const result = db
        .insert(verificationAssignments)
        .values({
          countId: c.id,
          itemId: c.itemId,
          eventId: user.eventId,
          assignedTeamId,
          assignedBy: user.id,
        })
        .run();

      created.push(Number(result.lastInsertRowid));
    }

    // Audit log
    db.insert(auditLog)
      .values({
        eventId: user.eventId,
        userId: user.id,
        userType: "supervisor",
        action: "assign_verification",
        tableName: "verification_assignments",
        newValue: JSON.stringify({
          countIds,
          assignedTeamId,
          verificationIds: created,
        }),
      })
      .run();

    return NextResponse.json({
      success: true,
      created: created.length,
      verificationIds: created,
    });
  } catch (error) {
    console.error("Verification assignment error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  const user = getApiUser(request);
  if (!user || user.type !== "supervisor") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const statusFilter = request.nextUrl.searchParams.get("status") as
    | "pending"
    | "completed"
    | "accepted"
    | null;

  let whereClause = eq(verificationAssignments.eventId, user.eventId);
  if (statusFilter) {
    whereClause = and(
      whereClause,
      eq(verificationAssignments.status, statusFilter)
    )!;
  }

  const assignments = db
    .select({
      id: verificationAssignments.id,
      countId: verificationAssignments.countId,
      itemId: verificationAssignments.itemId,
      assignedTeamId: verificationAssignments.assignedTeamId,
      teamName: teams.name,
      status: verificationAssignments.status,
      assignedAt: verificationAssignments.assignedAt,
      completedAt: verificationAssignments.completedAt,
      itemCode: items.itemCode,
      description: items.description,
    })
    .from(verificationAssignments)
    .innerJoin(teams, eq(verificationAssignments.assignedTeamId, teams.id))
    .innerJoin(items, eq(verificationAssignments.itemId, items.id))
    .where(whereClause)
    .all();

  return NextResponse.json({ assignments });
}
