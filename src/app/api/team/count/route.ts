import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { items, counts, auditLog, verificationAssignments } from "@/lib/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { getApiUser, checkEventActive } from "@/lib/api-auth";

export async function POST(request: NextRequest) {
  const user = getApiUser(request);
  if (!user || user.type !== "team") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const lockError = await checkEventActive(user.eventId);
  if (lockError) {
    return NextResponse.json({ error: lockError }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { itemId, countedQty, comment, clientId, verificationId } = body;

    if (itemId === undefined || countedQty === undefined) {
      return NextResponse.json(
        { error: "itemId and countedQty are required" },
        { status: 400 }
      );
    }

    if (typeof countedQty !== "number" || isNaN(countedQty) || countedQty < 0) {
      return NextResponse.json(
        { error: "countedQty must be a valid non-negative number" },
        { status: 400 }
      );
    }

    // Handle verification count submission
    if (verificationId) {
      // Entire verification flow inside a transaction to prevent race conditions
      const result = await db.transaction(async (tx) => {
        // Check assignment is still pending (inside transaction for atomicity)
        const [va] = await tx
          .select()
          .from(verificationAssignments)
          .where(
            and(
              eq(verificationAssignments.id, verificationId),
              eq(verificationAssignments.assignedTeamId, user.id),
              eq(verificationAssignments.eventId, user.eventId),
              eq(verificationAssignments.status, "pending")
            )
          );

        if (!va) {
          throw new Error("VERIFICATION_NOT_FOUND");
        }

        // Use the assignment's itemId to prevent client-supplied mismatch
        const verifiedItemId = va.itemId;

        const [item] = await tx
          .select()
          .from(items)
          .where(and(eq(items.id, verifiedItemId), eq(items.eventId, user.eventId)));

        if (!item) {
          throw new Error("VERIFICATION_NOT_FOUND");
        }

        const variance = countedQty - (item.onHand || 0);
        const varianceValue = variance * (item.avgCost || 0);
        const computedIsMatch = variance === 0;

        const [{ id: insertedId }] = await tx
          .insert(counts)
          .values({
            itemId: verifiedItemId,
            teamId: user.id,
            eventId: user.eventId,
            countedQty,
            variance,
            varianceValue,
            isMatch: computedIsMatch,
            comment: comment || null,
            countedAt: new Date().toISOString(),
            syncedAt: new Date().toISOString(),
            clientId: clientId || null,
            countType: "verification",
            verificationId,
          })
          .returning({ id: counts.id });

        await tx.update(verificationAssignments)
          .set({
            status: "completed",
            completedAt: new Date().toISOString(),
          })
          .where(eq(verificationAssignments.id, verificationId));

        const [inserted] = await tx
          .select()
          .from(counts)
          .where(eq(counts.id, insertedId));

        await tx.insert(auditLog)
          .values({
            eventId: user.eventId,
            userId: user.id,
            userType: "team",
            action: "verification_count",
            tableName: "counts",
            recordId: insertedId,
            newValue: JSON.stringify({
              countedQty,
              variance,
              verificationId,
            }),
          });

        return inserted;
      }).catch((err) => {
        if (err.message === "VERIFICATION_NOT_FOUND") return null;
        throw err;
      });

      if (!result) {
        return NextResponse.json(
          { error: "Verification assignment not found or not assigned to your team" },
          { status: 404 }
        );
      }

      return NextResponse.json({ success: true, count: result });
    }

    // Verify item belongs to this team
    const [item] = await db
      .select()
      .from(items)
      .where(
        and(
          eq(items.id, itemId),
          eq(items.teamId, user.id),
          eq(items.eventId, user.eventId)
        )
      );

    if (!item) {
      return NextResponse.json(
        { error: "Item not found or not assigned to your team" },
        { status: 404 }
      );
    }

    // Block edits when item has pending verification
    const [pendingVa] = await db
      .select({ id: verificationAssignments.id })
      .from(verificationAssignments)
      .where(
        and(
          eq(verificationAssignments.itemId, itemId),
          eq(verificationAssignments.eventId, user.eventId),
          eq(verificationAssignments.status, "pending")
        )
      );

    if (pendingVa) {
      return NextResponse.json(
        { error: "This item has a pending verification and cannot be edited" },
        { status: 403 }
      );
    }

    // Check for duplicate sync (clientId dedup - scoped to this team)
    if (clientId) {
      const [existing] = await db
        .select()
        .from(counts)
        .where(and(eq(counts.clientId, clientId), eq(counts.teamId, user.id)));

      if (existing) {
        return NextResponse.json({
          success: true,
          count: existing,
          deduplicated: true,
        });
      }
    }

    const variance = countedQty - (item.onHand || 0);
    const varianceValue = variance * (item.avgCost || 0);
    const computedIsMatch = variance === 0;

    // Wrap in transaction for atomicity
    const result = await db.transaction(async (tx) => {
      // Check if already counted (initial counts only) - update if so
      const [existingCount] = await tx
        .select()
        .from(counts)
        .where(
          and(
            eq(counts.itemId, itemId),
            eq(counts.teamId, user.id),
            eq(counts.countType, "initial")
          )
        );

      if (existingCount) {
        // Block updates to counts accepted/resolved by supervisor
        if (existingCount.checkStatus === "accepted") {
          throw new Error("SUPERVISOR_REVIEWED");
        }

        // Update existing count
        await tx.update(counts)
          .set({
            countedQty,
            variance,
            varianceValue,
            isMatch: computedIsMatch,
            comment: comment || existingCount.comment,
            countedAt: new Date().toISOString(),
            syncedAt: new Date().toISOString(),
            clientId: clientId || existingCount.clientId,
          })
          .where(eq(counts.id, existingCount.id));

        const [updated] = await tx
          .select()
          .from(counts)
          .where(eq(counts.id, existingCount.id));

        // Audit log
        await tx.insert(auditLog)
          .values({
            eventId: user.eventId,
            userId: user.id,
            userType: "team",
            action: "update_count",
            tableName: "counts",
            recordId: existingCount.id,
            oldValue: JSON.stringify({
              countedQty: existingCount.countedQty,
              variance: existingCount.variance,
            }),
            newValue: JSON.stringify({ countedQty, variance }),
          });

        return updated;
      } else {
        // Insert new count
        const [{ id: insertedId }] = await tx
          .insert(counts)
          .values({
            itemId,
            teamId: user.id,
            eventId: user.eventId,
            countedQty,
            variance,
            varianceValue,
            isMatch: computedIsMatch,
            comment: comment || null,
            countedAt: new Date().toISOString(),
            syncedAt: new Date().toISOString(),
            clientId: clientId || null,
          })
          .returning({ id: counts.id });

        const [inserted] = await tx
          .select()
          .from(counts)
          .where(eq(counts.id, insertedId));

        // Audit log
        await tx.insert(auditLog)
          .values({
            eventId: user.eventId,
            userId: user.id,
            userType: "team",
            action: "create_count",
            tableName: "counts",
            recordId: insertedId,
            newValue: JSON.stringify({ countedQty, variance, isMatch: computedIsMatch }),
          });

        return inserted;
      }
    }).catch((err) => {
      if (err.message === "SUPERVISOR_REVIEWED") return "SUPERVISOR_REVIEWED";
      throw err;
    });

    if (result === "SUPERVISOR_REVIEWED") {
      return NextResponse.json(
        { error: "This item has been reviewed by a supervisor and cannot be changed" },
        { status: 403 }
      );
    }

    return NextResponse.json({ success: true, count: result });
  } catch (error) {
    console.error("Count error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// Batch sync endpoint
export async function PUT(request: NextRequest) {
  const user = getApiUser(request);
  if (!user || user.type !== "team") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const lockError = await checkEventActive(user.eventId);
  if (lockError) {
    return NextResponse.json({ error: lockError }, { status: 403 });
  }

  try {
    const body = await request.json();
    const countBatch: Array<{
      itemId: number;
      countedQty: number;
      comment?: string;
      clientId?: string;
      countedAt?: string;
    }> = body.counts || [];
    const verificationBatch: Array<{
      verificationId: number;
      itemId: number;
      countedQty: number;
      comment?: string;
      clientId?: string;
      countedAt?: string;
    }> = body.verificationCounts || [];

    if (!Array.isArray(countBatch)) {
      return NextResponse.json(
        { error: "counts must be an array" },
        { status: 400 }
      );
    }

    const results: Array<{ itemId: number; success?: boolean; deduplicated?: boolean; error?: string }> = [];
    const verificationResults: Array<{ verificationId: number; success?: boolean; deduplicated?: boolean; error?: string }> = [];

    await db.transaction(async (tx) => {
      // ── Collect all IDs for bulk pre-fetch ──
      const allClientIds = [
        ...countBatch.filter((c) => c.clientId).map((c) => c.clientId!),
        ...verificationBatch.filter((c) => c.clientId).map((c) => c.clientId!),
      ];
      const allItemIds = countBatch.map((c) => c.itemId).filter((id) => typeof id === "number");
      const allVerificationIds = verificationBatch.map((v) => v.verificationId).filter((id) => typeof id === "number");

      // ── Bulk pre-fetch: dedup (all clientIds in one query) ──
      const dedupSet = new Set<string>();
      if (allClientIds.length > 0) {
        const dedupRows = await tx
          .select({ clientId: counts.clientId })
          .from(counts)
          .where(and(inArray(counts.clientId, allClientIds), eq(counts.teamId, user.id)));
        for (const row of dedupRows) {
          if (row.clientId) dedupSet.add(row.clientId);
        }
      }

      // ── Bulk pre-fetch: items for normal counts ──
      const itemMap = new Map<number, typeof items.$inferSelect>();
      if (allItemIds.length > 0) {
        const itemRows = await tx
          .select()
          .from(items)
          .where(
            and(
              inArray(items.id, allItemIds),
              eq(items.teamId, user.id),
              eq(items.eventId, user.eventId)
            )
          );
        for (const row of itemRows) {
          itemMap.set(row.id, row);
        }
      }

      // ── Bulk pre-fetch: pending verification assignments (block edits) ──
      const pendingVaSet = new Set<number>();
      if (allItemIds.length > 0) {
        const pendingVaRows = await tx
          .select({ itemId: verificationAssignments.itemId })
          .from(verificationAssignments)
          .where(
            and(
              inArray(verificationAssignments.itemId, allItemIds),
              eq(verificationAssignments.eventId, user.eventId),
              eq(verificationAssignments.status, "pending")
            )
          );
        for (const row of pendingVaRows) {
          pendingVaSet.add(row.itemId);
        }
      }

      // ── Bulk pre-fetch: existing initial counts for normal counts ──
      const existingCountMap = new Map<number, typeof counts.$inferSelect>();
      if (allItemIds.length > 0) {
        const existingRows = await tx
          .select()
          .from(counts)
          .where(
            and(
              inArray(counts.itemId, allItemIds),
              eq(counts.teamId, user.id),
              eq(counts.countType, "initial")
            )
          );
        for (const row of existingRows) {
          existingCountMap.set(row.itemId, row);
        }
      }

      // ── Process normal counts (pure in-memory lookups + INSERT/UPDATE) ──
      for (const entry of countBatch) {
        const { itemId, countedQty, comment, clientId } = entry;

        if (typeof countedQty !== "number" || isNaN(countedQty) || countedQty < 0) {
          results.push({ itemId, error: "countedQty must be a non-negative number" });
          continue;
        }

        if (clientId && dedupSet.has(clientId)) {
          results.push({ itemId, deduplicated: true });
          continue;
        }

        const item = itemMap.get(itemId);
        if (!item) {
          results.push({ itemId, error: "Not found" });
          continue;
        }

        if (pendingVaSet.has(itemId)) {
          results.push({ itemId, error: "Pending verification" });
          continue;
        }

        const variance = countedQty - (item.onHand || 0);
        const varianceValue = variance * (item.avgCost || 0);
        const computedIsMatch = variance === 0;

        const existingCount = existingCountMap.get(itemId);

        if (existingCount) {
          if (existingCount.checkStatus === "accepted") {
            results.push({ itemId, error: "Reviewed by supervisor" });
            continue;
          }

          await tx.update(counts)
            .set({
              countedQty,
              variance,
              varianceValue,
              isMatch: computedIsMatch,
              comment: comment || existingCount.comment,
              countedAt: new Date().toISOString(),
              syncedAt: new Date().toISOString(),
              clientId: clientId || existingCount.clientId,
            })
            .where(eq(counts.id, existingCount.id));
        } else {
          await tx.insert(counts)
            .values({
              itemId,
              teamId: user.id,
              eventId: user.eventId,
              countedQty,
              variance,
              varianceValue,
              isMatch: computedIsMatch,
              comment: comment || null,
              countedAt: new Date().toISOString(),
              syncedAt: new Date().toISOString(),
              clientId: clientId || null,
            });
        }

        results.push({ itemId, success: true });
      }

      // ── Process verification counts (if any) ──
      if (verificationBatch.length > 0) {
        // Bulk pre-fetch: verification assignments
        const vaMap = new Map<number, typeof verificationAssignments.$inferSelect>();
        if (allVerificationIds.length > 0) {
          const vaRows = await tx
            .select()
            .from(verificationAssignments)
            .where(
              and(
                inArray(verificationAssignments.id, allVerificationIds),
                eq(verificationAssignments.assignedTeamId, user.id),
                eq(verificationAssignments.status, "pending")
              )
            );
          for (const row of vaRows) {
            vaMap.set(row.id, row);
          }
        }

        // Bulk pre-fetch: items for verification (by itemId from assignments)
        const vaItemIds = Array.from(new Set(Array.from(vaMap.values()).map((va) => va.itemId)));
        const vaItemMap = new Map<number, typeof items.$inferSelect>();
        if (vaItemIds.length > 0) {
          const vaItemRows = await tx
            .select()
            .from(items)
            .where(
              and(
                inArray(items.id, vaItemIds),
                eq(items.eventId, user.eventId)
              )
            );
          for (const row of vaItemRows) {
            vaItemMap.set(row.id, row);
          }
        }

        for (const entry of verificationBatch) {
          const { verificationId, countedQty, comment, clientId } = entry;

          if (typeof countedQty !== "number" || isNaN(countedQty) || countedQty < 0) {
            verificationResults.push({ verificationId, error: "countedQty must be a non-negative number" });
            continue;
          }

          if (clientId && dedupSet.has(clientId)) {
            verificationResults.push({ verificationId, deduplicated: true });
            continue;
          }

          const va = vaMap.get(verificationId);
          if (!va) {
            verificationResults.push({ verificationId, error: "Assignment not found or not pending" });
            continue;
          }

          const item = vaItemMap.get(va.itemId);
          if (!item) {
            verificationResults.push({ verificationId, error: "Item not found" });
            continue;
          }

          const variance = countedQty - (item.onHand || 0);
          const varianceValue = variance * (item.avgCost || 0);
          const computedIsMatch = variance === 0;

          await tx.insert(counts)
            .values({
              itemId: va.itemId,
              teamId: user.id,
              eventId: user.eventId,
              countedQty,
              variance,
              varianceValue,
              isMatch: computedIsMatch,
              comment: comment || null,
              countedAt: new Date().toISOString(),
              syncedAt: new Date().toISOString(),
              clientId: clientId || null,
              countType: "verification",
              verificationId,
            });

          await tx.update(verificationAssignments)
            .set({
              status: "completed",
              completedAt: new Date().toISOString(),
            })
            .where(eq(verificationAssignments.id, verificationId));

          verificationResults.push({ verificationId, success: true });
        }
      }
    });

    return NextResponse.json({ success: true, results, verificationResults });
  } catch (error) {
    console.error("Batch sync error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
