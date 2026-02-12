import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { items, counts, teams, auditLog, verificationAssignments, serialDiscrepancies } from "@/lib/db/schema";
import { eq, and, sql, inArray } from "drizzle-orm";
import { getApiUser } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
  const user = getApiUser(request);
  if (!user || user.type !== "supervisor") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tab = request.nextUrl.searchParams.get("tab");

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
    serialNumber: items.serialNumber,
    isSerialized: items.isSerialized,
  };

  // 3-way filter: active (default), accepted, resolved
  const whereClause = tab === "resolved"
    ? and(
        eq(counts.eventId, user.eventId),
        eq(counts.checkStatus, "accepted"),
        eq(counts.isMatch, true)
      )
    : tab === "accepted"
      ? and(
          eq(counts.eventId, user.eventId),
          eq(counts.isMatch, false),
          eq(counts.checkStatus, "accepted")
        )
      : and(
          eq(counts.eventId, user.eventId),
          eq(counts.isMatch, false),
          sql`${counts.checkStatus} != 'accepted'`
        );

  const variances = await db
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
    .orderBy(sql`abs(variance_value) DESC`);

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
    const verifications = await db
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
      .where(and(inArray(verificationAssignments.countId, countIds), eq(verificationAssignments.eventId, user.eventId)));

    // For completed verifications, fetch the verification count records
    const verificationIds = verifications
      .filter((v) => v.status !== "pending")
      .map((v) => v.id);

    const verCountMap: Record<number, { countedQty: number; variance: number; countedAt: string }> = {};
    if (verificationIds.length > 0) {
      const verCounts = await db
        .select({
          verificationId: counts.verificationId,
          countedQty: counts.countedQty,
          variance: counts.variance,
          countedAt: counts.countedAt,
        })
        .from(counts)
        .where(
          and(
            eq(counts.eventId, user.eventId),
            eq(counts.countType, "verification"),
            inArray(counts.verificationId, verificationIds)
          )
        );

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

  const enrichedVariances: Record<string, unknown>[] = variances.map((v) => ({
    ...v,
    ...verificationMap[v.countId],
  }));

  // For the active tab, include unknown serials from open serial discrepancies as synthetic variance rows.
  // Each unknown serial represents a found item not in the expected list (variance = +1).
  if (!tab) {
    const openDiscrepancies = await db
      .select({
        id: serialDiscrepancies.id,
        itemCode: serialDiscrepancies.itemCode,
        description: serialDiscrepancies.description,
        binNumber: serialDiscrepancies.binNumber,
        unknownSerials: serialDiscrepancies.unknownSerials,
        teamName: teams.name,
      })
      .from(serialDiscrepancies)
      .innerJoin(teams, eq(serialDiscrepancies.teamId, teams.id))
      .where(
        and(
          eq(serialDiscrepancies.eventId, user.eventId),
          eq(serialDiscrepancies.status, "open")
        )
      );

    for (const disc of openDiscrepancies) {
      const unknowns: string[] = JSON.parse(disc.unknownSerials);
      if (unknowns.length === 0) continue;

      // Look up avgCost from any item with this itemCode in the event
      const [refItem] = await db
        .select({ avgCost: items.avgCost })
        .from(items)
        .where(
          and(
            eq(items.eventId, user.eventId),
            eq(items.itemCode, disc.itemCode)
          )
        );
      const avgCost = refItem?.avgCost ?? 0;

      for (let i = 0; i < unknowns.length; i++) {
        const varianceValue = 1 * avgCost;
        enrichedVariances.push({
          countId: -(disc.id * 1000 + i), // synthetic negative ID
          itemCode: disc.itemCode,
          description: disc.description,
          brand: null,
          binNumber: disc.binNumber,
          onHand: 0,
          avgCost,
          countedQty: 1,
          variance: 1,
          varianceValue,
          teamName: disc.teamName,
          comment: null,
          checkStatus: "pending",
          countedAt: null,
          isUnknownSerial: true,
          serialNumber: unknowns[i],
        });
      }
    }
  }

  const { totalVarianceValue, overCount, underCount, overValue, underValue, netVarianceValue } = enrichedVariances.reduce<{ totalVarianceValue: number; overCount: number; underCount: number; overValue: number; underValue: number; netVarianceValue: number }>(
    (acc, v) => {
      const variance = (v as { variance?: number }).variance || 0;
      const vv = (v as { varianceValue?: number }).varianceValue || 0;
      acc.totalVarianceValue += Math.abs(vv);
      if (variance > 0) {
        acc.overCount++;
        acc.overValue += Math.abs(vv);
      } else if (variance < 0) {
        acc.underCount++;
        acc.underValue += Math.abs(vv);
      }
      acc.netVarianceValue += vv;
      return acc;
    },
    { totalVarianceValue: 0, overCount: 0, underCount: 0, overValue: 0, underValue: 0, netVarianceValue: 0 }
  );

  return NextResponse.json({ variances: enrichedVariances, totalVarianceValue, overCount, underCount, overValue, underValue, netVarianceValue });
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

      const [va] = await db
        .select()
        .from(verificationAssignments)
        .where(
          and(
            eq(verificationAssignments.id, verificationId),
            eq(verificationAssignments.eventId, user.eventId)
          )
        );

      if (!va) {
        return NextResponse.json(
          { error: "Verification assignment not found" },
          { status: 404 }
        );
      }

      if (action === "accept_verification") {
        // Get the verification count
        const [verCount] = await db
          .select({
            countedQty: counts.countedQty,
            variance: counts.variance,
            varianceValue: counts.varianceValue,
          })
          .from(counts)
          .where(
            and(
              eq(counts.eventId, user.eventId),
              eq(counts.verificationId, verificationId),
              eq(counts.countType, "verification")
            )
          );

        if (!verCount) {
          return NextResponse.json(
            { error: "Verification count not found" },
            { status: 404 }
          );
        }

        // Update the original count with verification values
        const isMatch = verCount.variance === 0;
        await db.update(counts)
          .set({
            countedQty: verCount.countedQty,
            variance: verCount.variance,
            varianceValue: verCount.varianceValue,
            isMatch,
            checkStatus: "accepted",
          })
          .where(eq(counts.id, va.countId));
      } else {
        // accept_original — just mark the original as accepted
        await db.update(counts)
          .set({ checkStatus: "accepted" })
          .where(eq(counts.id, va.countId));
      }

      // Update verification assignment status
      await db.update(verificationAssignments)
        .set({ status: "accepted" })
        .where(eq(verificationAssignments.id, verificationId));

      // Audit log
      await db.insert(auditLog)
        .values({
          eventId: user.eventId,
          userId: user.id,
          userType: "supervisor",
          action: `verification_${action}`,
          tableName: "verification_assignments",
          recordId: verificationId,
          newValue: JSON.stringify({ action, countId: va.countId }),
        });

      return NextResponse.json({ success: true, action });
    }

    // Handle accept/reopen variance actions
    if (action === "accept_variance" || action === "reopen_variance") {
      if (!countId) {
        return NextResponse.json(
          { error: "countId is required" },
          { status: 400 }
        );
      }

      // Verify count belongs to supervisor's event
      const [count] = await db
        .select({ id: counts.id, eventId: counts.eventId })
        .from(counts)
        .where(eq(counts.id, countId));

      if (!count) {
        return NextResponse.json({ error: "Count not found" }, { status: 404 });
      }
      if (count.eventId !== user.eventId) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
      }

      const newStatus = action === "accept_variance" ? "accepted" : "pending";

      await db.update(counts)
        .set({ checkStatus: newStatus })
        .where(eq(counts.id, countId));

      await db.insert(auditLog)
        .values({
          eventId: user.eventId,
          userId: user.id,
          userType: "supervisor",
          action: action === "accept_variance" ? "supervisor_accept_variance" : "supervisor_reopen_variance",
          tableName: "counts",
          recordId: countId,
          newValue: JSON.stringify({ checkStatus: newStatus }),
        });

      return NextResponse.json({ success: true, action });
    }

    if (countId === undefined || newQty === undefined) {
      return NextResponse.json(
        { error: "countId and newQty are required" },
        { status: 400 }
      );
    }

    // Fetch count joined to item for recalculation
    const [existing] = await db
      .select({
        countId: counts.id,
        countedQty: counts.countedQty,
        variance: counts.variance,
        eventId: counts.eventId,
        onHand: items.onHand,
        avgCost: items.avgCost,
        isSerialized: items.isSerialized,
      })
      .from(counts)
      .innerJoin(items, eq(counts.itemId, items.id))
      .where(eq(counts.id, countId));

    if (!existing) {
      return NextResponse.json({ error: "Count not found" }, { status: 404 });
    }

    // Verify count belongs to supervisor's event
    if (existing.eventId !== user.eventId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    // Serialized items can only be 0 or 1
    if (existing.isSerialized && newQty > 1) {
      return NextResponse.json(
        { error: "Serialized items can only have a quantity of 0 or 1" },
        { status: 400 }
      );
    }

    const onHand = existing.onHand || 0;
    const avgCost = existing.avgCost || 0;
    const variance = newQty - onHand;
    const varianceValue = variance * avgCost;
    const isMatch = variance === 0;

    // Update the count
    await db.update(counts)
      .set({
        countedQty: newQty,
        variance,
        varianceValue,
        isMatch,
        checkStatus: "accepted",
      })
      .where(eq(counts.id, countId));

    // Audit log
    await db.insert(auditLog)
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
      });

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
