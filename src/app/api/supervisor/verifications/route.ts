import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { counts, verificationAssignments, items, teams, auditLog } from "@/lib/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { requireUser, resolveEventId, checkEventActive } from "@/lib/api-auth";

export async function POST(request: NextRequest) {
  const auth = await requireUser(request, { roles: ["supervisor"], status: 401, write: true });
  if (auth.response) return auth.response;
  const { user } = auth;

  const lockError = await checkEventActive(user.eventId);
  if (lockError) {
    return NextResponse.json({ error: lockError }, { status: 403 });
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
    const [team] = await db
      .select({ id: teams.id })
      .from(teams)
      .where(and(eq(teams.id, assignedTeamId), eq(teams.eventId, user.eventId)));

    if (!team) {
      return NextResponse.json(
        { error: "Team not found in this event" },
        { status: 404 }
      );
    }

    // Fetch the counts and validate
    const targetCounts = await db
      .select({
        id: counts.id,
        itemId: counts.itemId,
        eventId: counts.eventId,
        isMatch: counts.isMatch,
      })
      .from(counts)
      .where(and(inArray(counts.id, countIds), eq(counts.eventId, user.eventId)));

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

    // Block a new recount while an earlier one is still open: either in
    // progress ("pending") or submitted but awaiting the supervisor's decision
    // ("completed"). Otherwise two verifications compete for the same count.
    const itemIds = targetCounts.map((c) => c.itemId);
    const existingVerifications = await db
      .select({ itemId: verificationAssignments.itemId, status: verificationAssignments.status })
      .from(verificationAssignments)
      .where(
        and(
          inArray(verificationAssignments.itemId, itemIds),
          eq(verificationAssignments.eventId, user.eventId),
          inArray(verificationAssignments.status, ["pending", "completed"])
        )
      );

    if (existingVerifications.length > 0) {
      const pendingIds = existingVerifications.filter((v) => v.status === "pending").map((v) => v.itemId);
      const undecidedIds = existingVerifications.filter((v) => v.status !== "pending").map((v) => v.itemId);
      const parts: string[] = [];
      if (pendingIds.length > 0) parts.push(`pending verification for item(s): ${pendingIds.join(", ")}`);
      if (undecidedIds.length > 0) {
        parts.push(`completed verification awaiting a decision (keep original or accept verified) for item(s): ${undecidedIds.join(", ")}`);
      }
      return NextResponse.json(
        { error: `Cannot assign a new verification: ${parts.join("; ")}` },
        { status: 409 }
      );
    }

    // Insert verification assignments
    const created: number[] = [];
    for (const c of targetCounts) {
      const [{ id }] = await db
        .insert(verificationAssignments)
        .values({
          countId: c.id,
          itemId: c.itemId,
          eventId: user.eventId,
          assignedTeamId,
          assignedBy: user.id,
        })
        .returning({ id: verificationAssignments.id });

      created.push(id);
    }

    // Audit log
    await db.insert(auditLog)
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
      });

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
  const auth = await requireUser(request, { roles: ["supervisor", "auditor", "executive"], status: 401 });
  if (auth.response) return auth.response;
  const { user } = auth;

  // Admins/executives log in with eventId 0 and pick the event via ?eventId
  const eventId = resolveEventId(user, request.nextUrl.searchParams.get("eventId"));
  if (!eventId) {
    return NextResponse.json({ error: "eventId is required" }, { status: 400 });
  }

  const statusFilter = request.nextUrl.searchParams.get("status") as
    | "pending"
    | "completed"
    | "accepted"
    | null;

  let whereClause = eq(verificationAssignments.eventId, eventId);
  if (statusFilter) {
    whereClause = and(
      whereClause,
      eq(verificationAssignments.status, statusFilter)
    )!;
  }

  const assignments = await db
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
    .where(whereClause);

  return NextResponse.json({ assignments });
}
