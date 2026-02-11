import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { items, counts, teams, auditLog, verificationAssignments } from "@/lib/db/schema";
import { eq, and, sql, inArray } from "drizzle-orm";
import { getApiUser } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
  const user = getApiUser(request);
  if (!user || user.type !== "supervisor") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tab = request.nextUrl.searchParams.get("tab");
  const isResolved = tab === "resolved";

  const selectShape = {
    countId: counts.id,
    itemCode: items.itemCode,
    description: items.description,
    brand: items.brand,
    binNumber: items.binNumber,
    onHand: items.onHand,
    avgCost: items.avgCost,
    countedQty: counts.countedQty,
    variance: counts.variance,
    varianceValue: counts.varianceValue,
    teamName: teams.name,
    comment: counts.comment,
    checkStatus: counts.checkStatus,
    countedAt: counts.countedAt,
  };

  const whereClause = isResolved
    ? and(
        eq(counts.eventId, user.eventId),
        eq(counts.checkStatus, "accepted"),
        eq(counts.isMatch, true)
      )
    : and(eq(counts.eventId, user.eventId), eq(counts.isMatch, false));

  const variances = db
    .select(selectShape)
    .from(counts)
    .innerJoin(items, eq(counts.itemId, items.id))
    .innerJoin(teams, eq(counts.teamId, teams.id))
    .where(
      and(
        whereClause,
        eq(counts.countType, "initial")
      )
    )
    .orderBy(sql`abs(variance_value) DESC`)
    .all();

  // Enrich with verification data
  const countIds = variances.map((v) => v.countId);
  const verificationMap: Record<number, {
    verificationId: number;
    verificationStatus: string;
    verificationTeamName: string;
    verificationTeamId: number;
    verificationQty: number | null;
    verificationVariance: number | null;
    verificationCountedAt: string | null;
  }> = {};

  if (countIds.length > 0) {
    const verifications = db
      .select({
        id: verificationAssignments.id,
        countId: verificationAssignments.countId,
        status: verificationAssignments.status,
        teamName: teams.name,
        teamId: verificationAssignments.assignedTeamId,
        completedAt: verificationAssignments.completedAt,
      })
      .from(verificationAssignments)
      .innerJoin(teams, eq(verificationAssignments.assignedTeamId, teams.id))
      .where(inArray(verificationAssignments.countId, countIds))
      .all();

    // For completed verifications, fetch the verification count records
    const verificationIds = verifications
      .filter((v) => v.status !== "pending")
      .map((v) => v.id);

    const verCountMap: Record<number, { countedQty: number; variance: number; countedAt: string }> = {};
    if (verificationIds.length > 0) {
      const verCounts = db
        .select({
          verificationId: counts.verificationId,
          countedQty: counts.countedQty,
          variance: counts.variance,
          countedAt: counts.countedAt,
        })
        .from(counts)
        .where(
          and(
            eq(counts.countType, "verification"),
            inArray(counts.verificationId, verificationIds)
          )
        )
        .all();

      for (const vc of verCounts) {
        if (vc.verificationId != null) {
          verCountMap[vc.verificationId] = {
            countedQty: vc.countedQty,
            variance: vc.variance ?? 0,
            countedAt: vc.countedAt,
          };
        }
      }
    }

    for (const v of verifications) {
      const verCount = verCountMap[v.id];
      verificationMap[v.countId] = {
        verificationId: v.id,
        verificationStatus: v.status,
        verificationTeamName: v.teamName,
        verificationTeamId: v.teamId,
        verificationQty: verCount?.countedQty ?? null,
        verificationVariance: verCount?.variance ?? null,
        verificationCountedAt: verCount?.countedAt ?? null,
      };
    }
  }

  const enrichedVariances = variances.map((v) => ({
    ...v,
    ...verificationMap[v.countId],
  }));

  const totalVarianceValue = variances.reduce(
    (sum, v) => sum + Math.abs(v.varianceValue || 0),
    0
  );

  return NextResponse.json({ variances: enrichedVariances, totalVarianceValue });
}

export async function PATCH(request: NextRequest) {
  const user = getApiUser(request);
  if (!user || user.type !== "supervisor") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { countId, newQty, reason, action, verificationId } = body;

    // Handle verification acceptance actions
    if (action === "accept_original" || action === "accept_verification") {
      if (!verificationId) {
        return NextResponse.json(
          { error: "verificationId is required" },
          { status: 400 }
        );
      }

      const va = db
        .select()
        .from(verificationAssignments)
        .where(
          and(
            eq(verificationAssignments.id, verificationId),
            eq(verificationAssignments.eventId, user.eventId)
          )
        )
        .get();

      if (!va) {
        return NextResponse.json(
          { error: "Verification assignment not found" },
          { status: 404 }
        );
      }

      if (action === "accept_verification") {
        // Get the verification count
        const verCount = db
          .select({
            countedQty: counts.countedQty,
            variance: counts.variance,
            varianceValue: counts.varianceValue,
          })
          .from(counts)
          .where(
            and(
              eq(counts.verificationId, verificationId),
              eq(counts.countType, "verification")
            )
          )
          .get();

        if (!verCount) {
          return NextResponse.json(
            { error: "Verification count not found" },
            { status: 404 }
          );
        }

        // Update the original count with verification values
        const isMatch = verCount.variance === 0;
        db.update(counts)
          .set({
            countedQty: verCount.countedQty,
            variance: verCount.variance,
            varianceValue: verCount.varianceValue,
            isMatch,
            checkStatus: "accepted",
          })
          .where(eq(counts.id, va.countId))
          .run();
      } else {
        // accept_original — just mark the original as accepted
        db.update(counts)
          .set({ checkStatus: "accepted" })
          .where(eq(counts.id, va.countId))
          .run();
      }

      // Update verification assignment status
      db.update(verificationAssignments)
        .set({ status: "accepted" })
        .where(eq(verificationAssignments.id, verificationId))
        .run();

      // Audit log
      db.insert(auditLog)
        .values({
          eventId: user.eventId,
          userId: user.id,
          userType: "supervisor",
          action: `verification_${action}`,
          tableName: "verification_assignments",
          recordId: verificationId,
          newValue: JSON.stringify({ action, countId: va.countId }),
        })
        .run();

      return NextResponse.json({ success: true, action });
    }

    if (countId === undefined || newQty === undefined) {
      return NextResponse.json(
        { error: "countId and newQty are required" },
        { status: 400 }
      );
    }

    // Fetch count joined to item for recalculation
    const existing = db
      .select({
        countId: counts.id,
        countedQty: counts.countedQty,
        variance: counts.variance,
        eventId: counts.eventId,
        onHand: items.onHand,
        avgCost: items.avgCost,
      })
      .from(counts)
      .innerJoin(items, eq(counts.itemId, items.id))
      .where(eq(counts.id, countId))
      .get();

    if (!existing) {
      return NextResponse.json({ error: "Count not found" }, { status: 404 });
    }

    // Verify count belongs to supervisor's event
    if (existing.eventId !== user.eventId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const onHand = existing.onHand || 0;
    const avgCost = existing.avgCost || 0;
    const variance = newQty - onHand;
    const varianceValue = variance * avgCost;
    const isMatch = variance === 0;

    // Update the count
    db.update(counts)
      .set({
        countedQty: newQty,
        variance,
        varianceValue,
        isMatch,
        checkStatus: "accepted",
      })
      .where(eq(counts.id, countId))
      .run();

    // Audit log
    db.insert(auditLog)
      .values({
        eventId: user.eventId,
        userId: user.id,
        userType: "supervisor",
        action: "supervisor_edit_count",
        tableName: "counts",
        recordId: countId,
        oldValue: JSON.stringify({
          countedQty: existing.countedQty,
          variance: existing.variance,
        }),
        newValue: JSON.stringify({
          countedQty: newQty,
          variance,
          ...(reason ? { reason } : {}),
        }),
      })
      .run();

    return NextResponse.json({
      success: true,
      count: {
        countId,
        countedQty: newQty,
        variance,
        varianceValue,
        isMatch,
      },
    });
  } catch (error) {
    console.error("Supervisor edit count error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
