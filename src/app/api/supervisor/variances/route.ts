import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { items, counts, teams, auditLog, verificationAssignments, serialDiscrepancies } from "@/lib/db/schema";
import { eq, and, sql, inArray } from "drizzle-orm";
import { requireUser, resolveEventId, checkEventActive, getEventWarehouses, warehouseFilter, buildItemRefMap, isRefOutsideWarehouses } from "@/lib/api-auth";
import { safeJsonParse } from "@/lib/utils";

export async function GET(request: NextRequest) {
  const auth = await requireUser(request, { roles: ["supervisor", "auditor", "executive"], status: 401 });
  if (auth.response) return auth.response;
  const { user } = auth;

  const tab = request.nextUrl.searchParams.get("tab");

  // Executives have eventId=0; allow override via query param
  const eventId = resolveEventId(user, request.nextUrl.searchParams.get("eventId"));
  if (!eventId) {
    return NextResponse.json({ error: "eventId is required" }, { status: 400 });
  }

  const warehouses = await getEventWarehouses(eventId);

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
    teamId: counts.teamId,
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
        eq(counts.eventId, eventId),
        eq(counts.checkStatus, "accepted"),
        eq(counts.isMatch, true)
      )
    : tab === "accepted"
      ? and(
          eq(counts.eventId, eventId),
          eq(counts.isMatch, false),
          eq(counts.checkStatus, "accepted")
        )
      : and(
          eq(counts.eventId, eventId),
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
        eq(counts.countType, "initial"),
        warehouseFilter(warehouses),
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
      .where(and(inArray(verificationAssignments.countId, countIds), eq(verificationAssignments.eventId, eventId)));

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
            eq(counts.eventId, eventId),
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
        verificationTeamId: serialDiscrepancies.verificationTeamId,
        verificationStatus: serialDiscrepancies.verificationStatus,
        verificationCompletedAt: serialDiscrepancies.verificationCompletedAt,
        verifiedSerials: serialDiscrepancies.verifiedSerials,
      })
      .from(serialDiscrepancies)
      .innerJoin(teams, eq(serialDiscrepancies.teamId, teams.id))
      .where(
        and(
          eq(serialDiscrepancies.eventId, eventId),
          eq(serialDiscrepancies.status, "open")
        )
      );

    // Build a map of verification team names for discrepancies that have one
    const verTeamIds = Array.from(new Set(openDiscrepancies.filter((d) => d.verificationTeamId).map((d) => d.verificationTeamId!)));
    const verTeamNameMap: Record<number, string> = {};
    if (verTeamIds.length > 0) {
      const verTeams = await db
        .select({ id: teams.id, name: teams.name })
        .from(teams)
        .where(inArray(teams.id, verTeamIds));
      for (const vt of verTeams) {
        verTeamNameMap[vt.id] = vt.name;
      }
    }

    // Batch-fetch item metadata for all discrepancy itemCodes (avoids N+1)
    const refMap = await buildItemRefMap(eventId, openDiscrepancies.map((d) => d.itemCode), warehouses);

    for (const disc of openDiscrepancies) {
      const unknowns: string[] = safeJsonParse<string[]>(disc.unknownSerials, []);
      if (unknowns.length === 0) continue;

      const finalRef = refMap.get(disc.itemCode);
      // Skip if source item's warehouse is not in the event's selected warehouses
      if (isRefOutsideWarehouses(finalRef, warehouses)) continue;
      const avgCost = finalRef?.avgCost ?? 0;

      // Parse verified serials if completed
      const parsedVerifiedSerials = disc.verifiedSerials
        ? safeJsonParse<{ serial: string; status: string }[]>(disc.verifiedSerials, [])
        : null;

      for (let i = 0; i < unknowns.length; i++) {
        const varianceValue = 1 * avgCost;

        // Find this serial's verification result if completed
        const serialVerResult = parsedVerifiedSerials?.find((v) => v.serial === unknowns[i]);

        enrichedVariances.push({
          countId: -(disc.id * 100000 + i), // synthetic negative ID
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
          discrepancyId: disc.id,
          serialIndex: i,
          internalId: finalRef?.internalId ?? null,
          warehouse: finalRef?.warehouse ?? null,
          division: finalRef?.division ?? null,
          stockStatus: finalRef?.stockStatus ?? null,
          serialVerificationStatus: disc.verificationStatus ?? null,
          serialVerificationTeamId: disc.verificationTeamId ?? null,
          serialVerificationTeamName: disc.verificationTeamId ? (verTeamNameMap[disc.verificationTeamId] ?? null) : null,
          serialVerificationResult: serialVerResult?.status ?? null,
        });
      }
    }
  }

  // For the accepted tab, include approved serials from resolved discrepancies as synthetic rows.
  if (tab === "accepted") {
    const approvedDiscrepancies = await db
      .select({
        id: serialDiscrepancies.id,
        itemCode: serialDiscrepancies.itemCode,
        description: serialDiscrepancies.description,
        binNumber: serialDiscrepancies.binNumber,
        approvedSerials: serialDiscrepancies.approvedSerials,
        teamName: teams.name,
      })
      .from(serialDiscrepancies)
      .innerJoin(teams, eq(serialDiscrepancies.teamId, teams.id))
      .where(
        and(
          eq(serialDiscrepancies.eventId, eventId),
          sql`${serialDiscrepancies.approvedSerials} IS NOT NULL AND ${serialDiscrepancies.approvedSerials} != '[]'`
        )
      );

    // Batch-fetch item metadata for approved discrepancy itemCodes
    const approvedRefMap = await buildItemRefMap(eventId, approvedDiscrepancies.map((d) => d.itemCode), warehouses);

    for (const disc of approvedDiscrepancies) {
      const approved: string[] = safeJsonParse<string[]>(disc.approvedSerials, []);
      if (approved.length === 0) continue;

      const finalRef2 = approvedRefMap.get(disc.itemCode);
      // Skip if source item's warehouse is not in the event's selected warehouses
      if (isRefOutsideWarehouses(finalRef2, warehouses)) continue;
      const avgCost = finalRef2?.avgCost ?? 0;

      for (let i = 0; i < approved.length; i++) {
        const varianceValue = 1 * avgCost;
        enrichedVariances.push({
          countId: -(disc.id * 100000 + 50000 + i), // synthetic negative ID (offset to avoid collision)
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
          checkStatus: "accepted",
          countedAt: null,
          isUnknownSerial: true,
          isApprovedSerial: true,
          serialNumber: approved[i],
          discrepancyId: disc.id,
          serialIndex: i,
          internalId: finalRef2?.internalId ?? null,
          warehouse: finalRef2?.warehouse ?? null,
          division: finalRef2?.division ?? null,
          stockStatus: finalRef2?.stockStatus ?? null,
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
  const auth = await requireUser(request, { roles: ["supervisor"], status: 401, write: true });
  if (auth.response) return auth.response;
  const { user } = auth;

  const lockError = await checkEventActive(user.eventId);
  if (lockError) {
    return NextResponse.json({ error: lockError }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { countId, newQty, reason, action, verificationId, countIds } = body;

    // Handle bulk accept variance
    if (action === "bulk_accept_variance") {
      if (!Array.isArray(countIds) || countIds.length === 0) {
        return NextResponse.json({ error: "countIds array is required" }, { status: 400 });
      }

      // Verify all counts belong to this event
      const validCounts = await db
        .select({ id: counts.id })
        .from(counts)
        .where(and(inArray(counts.id, countIds), eq(counts.eventId, user.eventId)));

      const validIds = validCounts.map((c) => c.id);
      if (validIds.length === 0) {
        return NextResponse.json({ error: "No valid counts found" }, { status: 404 });
      }

      await db.update(counts)
        .set({ checkStatus: "accepted" })
        .where(inArray(counts.id, validIds));

      // Audit log entries
      await Promise.all(
        validIds.map((id) =>
          db.insert(auditLog).values({
            eventId: user.eventId,
            userId: user.id,
            userType: "supervisor",
            action: "supervisor_accept_variance",
            tableName: "counts",
            recordId: id,
            newValue: JSON.stringify({ checkStatus: "accepted", bulk: true }),
          })
        )
      );

      return NextResponse.json({ success: true, acceptedCount: validIds.length });
    }

    // Handle verification acceptance actions
    if (action === "accept_original" || action === "accept_verification") {
      if (!verificationId) {
        return NextResponse.json(
          { error: "verificationId is required" },
          { status: 400 }
        );
      }

      // Wrap in transaction to prevent race conditions between concurrent acceptances
      const txResult = await db.transaction(async (tx) => {
        const [va] = await tx
          .select()
          .from(verificationAssignments)
          .where(
            and(
              eq(verificationAssignments.id, verificationId),
              eq(verificationAssignments.eventId, user.eventId)
            )
          );

        if (!va) {
          throw new Error("VA_NOT_FOUND");
        }

        // Prevent double-acceptance
        if (va.status === "accepted") {
          throw new Error("VA_ALREADY_ACCEPTED");
        }

        if (action === "accept_verification") {
          const [verCount] = await tx
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
            throw new Error("VER_COUNT_NOT_FOUND");
          }

          const isMatch = verCount.variance === 0;
          await tx.update(counts)
            .set({
              countedQty: verCount.countedQty,
              variance: verCount.variance,
              varianceValue: verCount.varianceValue,
              isMatch,
              checkStatus: "accepted",
            })
            .where(eq(counts.id, va.countId));

          // Also mark the verification count row as accepted so the export
          // can distinguish accepted vs unaccepted verification counts
          await tx.update(counts)
            .set({ checkStatus: "accepted" })
            .where(
              and(
                eq(counts.verificationId, verificationId),
                eq(counts.countType, "verification")
              )
            );
        } else {
          await tx.update(counts)
            .set({ checkStatus: "accepted" })
            .where(eq(counts.id, va.countId));
        }

        await tx.update(verificationAssignments)
          .set({ status: "accepted" })
          .where(eq(verificationAssignments.id, verificationId));

        await tx.insert(auditLog)
          .values({
            eventId: user.eventId,
            userId: user.id,
            userType: "supervisor",
            action: `verification_${action}`,
            tableName: "verification_assignments",
            recordId: verificationId,
            newValue: JSON.stringify({ action, countId: va.countId }),
          });

        return { success: true };
      }).catch((err) => {
        if (err.message === "VA_NOT_FOUND") return { error: "Verification assignment not found", status: 404 };
        if (err.message === "VA_ALREADY_ACCEPTED") return { error: "Verification already accepted", status: 409 };
        if (err.message === "VER_COUNT_NOT_FOUND") return { error: "Verification count not found", status: 404 };
        throw err;
      });

      if ("error" in txResult) {
        return NextResponse.json({ error: txResult.error }, { status: txResult.status });
      }

      return NextResponse.json({ success: true, action });
    }

    // Unknown/approved serial actions (edit, approve, dismiss).
    // Rows use a synthetic countId: -(disc.id * 100000 + i) for unknowns and
    // -(disc.id * 100000 + 50000 + i) for approved serials. When the client also
    // sends the serial value (`serial`), the serial is matched by value so a stale
    // index can't touch the wrong serial. Read-modify-write of the JSON arrays runs
    // in a transaction with the discrepancy row locked FOR UPDATE.
    if (
      action === "edit_unknown_serial" ||
      action === "edit_approved_serial" ||
      action === "approve_unknown_serial" ||
      action === "dismiss_unknown_serial"
    ) {
      if (countId === undefined || countId === null || typeof countId !== "number") {
        return NextResponse.json({ error: "countId is required" }, { status: 400 });
      }

      const isEdit = action === "edit_unknown_serial" || action === "edit_approved_serial";
      const onApproved = action === "edit_approved_serial";
      let trimmed = "";
      if (isEdit) {
        const { newSerial } = body;
        if (!newSerial || typeof newSerial !== "string") {
          return NextResponse.json({ error: "countId and newSerial are required" }, { status: 400 });
        }
        trimmed = newSerial.trim();
        if (trimmed.length === 0) {
          return NextResponse.json({ error: "Serial number cannot be empty" }, { status: 400 });
        }
      }

      const clientSerial: string | null = typeof body.serial === "string" ? body.serial : null;
      const absId = Math.abs(countId);
      const discrepancyId = Math.floor(absId / 100000);
      const indexHint = onApproved ? (absId % 100000) - 50000 : absId % 100000;

      class SerialActionError extends Error {
        constructor(message: string, public status: number) { super(message); }
      }

      try {
        const result = await db.transaction(async (tx) => {
          const [disc] = await tx
            .select()
            .from(serialDiscrepancies)
            .where(
              and(
                eq(serialDiscrepancies.id, discrepancyId),
                eq(serialDiscrepancies.eventId, user.eventId)
              )
            )
            .for("update");

          if (!disc) throw new SerialActionError("Discrepancy not found", 404);

          // Prevent modifying unknowns while a team is verifying them
          if (!onApproved && disc.verificationStatus === "pending") {
            throw new SerialActionError(
              isEdit
                ? "Cannot edit serial while verification is in progress"
                : "Cannot modify serials while verification is in progress",
              409
            );
          }

          const unknowns: string[] = safeJsonParse<string[]>(disc.unknownSerials, []);
          const approved: string[] = safeJsonParse<string[]>(disc.approvedSerials, []);
          const list = onApproved ? approved : unknowns;

          let idx: number;
          if (clientSerial !== null) {
            idx = list[indexHint] === clientSerial ? indexHint : list.indexOf(clientSerial);
            if (idx === -1) {
              throw new SerialActionError("Serial no longer exists — please refresh", 409);
            }
          } else {
            idx = indexHint;
            if (idx < 0 || idx >= list.length) {
              throw new SerialActionError(
                onApproved ? "Approved serial index out of range" : "Serial index out of range",
                400
              );
            }
          }

          const serial = list[idx];

          if (isEdit) {
            list[idx] = trimmed;
            await tx.update(serialDiscrepancies)
              .set(onApproved
                ? { approvedSerials: JSON.stringify(approved) }
                : { unknownSerials: JSON.stringify(unknowns) })
              .where(eq(serialDiscrepancies.id, discrepancyId));

            await tx.insert(auditLog)
              .values({
                eventId: user.eventId,
                userId: user.id,
                userType: "supervisor",
                action: onApproved ? "serial_edit_approved" : "serial_edit_unknown",
                tableName: "serial_discrepancies",
                recordId: discrepancyId,
                oldValue: JSON.stringify({ serial, index: idx }),
                newValue: JSON.stringify({ serial: trimmed, index: idx }),
              });

            return { oldSerial: serial };
          }

          const newUnknowns = unknowns.filter((_, i) => i !== idx);
          const updates: Record<string, unknown> = {
            unknownSerials: JSON.stringify(newUnknowns),
          };

          if (action === "approve_unknown_serial") {
            approved.push(serial);
            updates.approvedSerials = JSON.stringify(approved);
          }

          // If no unknowns left, mark resolved (approved if any serial was approved)
          if (newUnknowns.length === 0) {
            updates.status = "resolved";
            updates.resolutionType = approved.length > 0 ? "approved" : "dismissed";
            updates.resolvedBy = user.id;
            updates.resolvedAt = new Date().toISOString();
          }

          await tx.update(serialDiscrepancies)
            .set(updates)
            .where(eq(serialDiscrepancies.id, discrepancyId));

          await tx.insert(auditLog)
            .values({
              eventId: user.eventId,
              userId: user.id,
              userType: "supervisor",
              action: action === "approve_unknown_serial" ? "serial_approve_unknown" : "serial_dismiss_unknown",
              tableName: "serial_discrepancies",
              recordId: discrepancyId,
              newValue: JSON.stringify({ serial, action }),
            });

          return { oldSerial: serial };
        });

        if (isEdit) {
          return NextResponse.json({ success: true, action, oldSerial: result.oldSerial, newSerial: trimmed });
        }
        return NextResponse.json({ success: true, action });
      } catch (err) {
        if (err instanceof SerialActionError) {
          return NextResponse.json({ error: err.message }, { status: err.status });
        }
        throw err;
      }
    }

    // Handle accept/reopen variance actions
    if (action === "accept_variance" || action === "reopen_variance") {
      if (countId === undefined || countId === null) {
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

    if (typeof newQty !== "number" || isNaN(newQty) || newQty < 0) {
      return NextResponse.json(
        { error: "newQty must be a valid non-negative number" },
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
