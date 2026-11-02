import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { items, counts, auditLog, verificationAssignments } from "@/lib/db/schema";
import { eq, and, inArray, asc } from "drizzle-orm";
import { requireUser, checkEventActive } from "@/lib/api-auth";

/**
 * Use the client's countedAt (when the count was actually taken, possibly
 * offline) so replays can be ordered. Invalid or future timestamps fall back
 * to / are clamped at server time.
 */
function resolveCountedAt(raw: unknown): string {
  const now = Date.now();
  if (typeof raw === "string") {
    const t = Date.parse(raw);
    if (!isNaN(t)) return new Date(Math.min(t, now)).toISOString();
  }
  return new Date(now).toISOString();
}

/** True when `incoming` is strictly older than the stored row's countedAt. */
function isOlderThan(incoming: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  const a = Date.parse(incoming);
  const b = Date.parse(stored);
  if (isNaN(a) || isNaN(b)) return false;
  return a < b;
}

/** undefined = keep existing comment; null / "" = clear it. */
function resolveComment(incoming: unknown, existing: string | null): string | null {
  if (incoming === undefined) return existing;
  return typeof incoming === "string" && incoming.length > 0 ? incoming : null;
}

export async function POST(request: NextRequest) {
  const auth = await requireUser(request, { roles: ["team"], status: 401, write: true });
  if (auth.response) return auth.response;
  const { user } = auth;

  const lockError = await checkEventActive(user.eventId);
  if (lockError) {
    return NextResponse.json({ error: lockError }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { itemId, countedQty, comment, clientId, verificationId } = body;
    const countedAt = resolveCountedAt(body.countedAt);

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
        // Replay of an already-applied submission (e.g. immediate POST raced the sync PUT)
        if (clientId) {
          const [existing] = await tx
            .select()
            .from(counts)
            .where(and(eq(counts.clientId, clientId), eq(counts.teamId, user.id)));
          if (existing) return { deduplicated: existing };
        }

        // Lock the assignment row so concurrent submissions serialize; the
        // loser re-reads status after the winner commits and sees "completed".
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
          )
          .for("update");

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

        const insertedRows = await tx
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
            countedAt,
            syncedAt: new Date().toISOString(),
            clientId: clientId || null,
            countType: "verification",
            verificationId,
          })
          .onConflictDoNothing()
          .returning({ id: counts.id });

        if (insertedRows.length === 0) {
          // Unique index (client_id/team_id or verification_id) hit by a concurrent submission
          throw new Error("VERIFICATION_NOT_FOUND");
        }
        const insertedId = insertedRows[0].id;

        await tx.update(verificationAssignments)
          .set({
            status: "completed",
            completedAt: new Date().toISOString(),
          })
          .where(
            and(
              eq(verificationAssignments.id, verificationId),
              eq(verificationAssignments.status, "pending")
            )
          );

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

        return { inserted };
      }).catch((err) => {
        if (err.message === "VERIFICATION_NOT_FOUND") return null;
        throw err;
      });

      if (!result && clientId) {
        // Lost a race to a concurrent request carrying the same clientId
        const [existing] = await db
          .select()
          .from(counts)
          .where(and(eq(counts.clientId, clientId), eq(counts.teamId, user.id)));
        if (existing) {
          return NextResponse.json({ success: true, count: existing, deduplicated: true });
        }
      }

      if (!result) {
        return NextResponse.json(
          { error: "Verification assignment not found, already completed, or not assigned to your team" },
          { status: 404 }
        );
      }

      if ("deduplicated" in result) {
        return NextResponse.json({ success: true, count: result.deduplicated, deduplicated: true });
      }

      return NextResponse.json({ success: true, count: result.inserted });
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
      // Serialize concurrent writes for this item (immediate POST vs. sync PUT)
      await tx
        .select({ id: items.id })
        .from(items)
        .where(eq(items.id, itemId))
        .for("update");

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

        // Same submission already applied by a concurrent request, or an older
        // replay that must not overwrite a newer count: keep the stored row.
        if (
          (clientId && existingCount.clientId === clientId) ||
          isOlderThan(countedAt, existingCount.countedAt)
        ) {
          return { row: existingCount, deduplicated: true };
        }

        // Update existing count
        await tx.update(counts)
          .set({
            countedQty,
            variance,
            varianceValue,
            isMatch: computedIsMatch,
            comment: resolveComment(comment, existingCount.comment),
            countedAt,
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

        return { row: updated, deduplicated: false };
      } else {
        // Insert new count
        const insertedRows = await tx
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
            countedAt,
            syncedAt: new Date().toISOString(),
            clientId: clientId || null,
          })
          .onConflictDoNothing()
          .returning({ id: counts.id });

        if (insertedRows.length === 0) {
          // clientId already inserted by a concurrent request
          const [existing] = await tx
            .select()
            .from(counts)
            .where(and(eq(counts.clientId, clientId), eq(counts.teamId, user.id)));
          return { row: existing, deduplicated: true };
        }
        const insertedId = insertedRows[0].id;

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

        return { row: inserted, deduplicated: false };
      }
    }).catch((err) => {
      if (err.message === "SUPERVISOR_REVIEWED") return "SUPERVISOR_REVIEWED" as const;
      throw err;
    });

    if (result === "SUPERVISOR_REVIEWED") {
      return NextResponse.json(
        { error: "This item has been reviewed by a supervisor and cannot be changed" },
        { status: 403 }
      );
    }

    return NextResponse.json({
      success: true,
      count: result.row,
      ...(result.deduplicated ? { deduplicated: true } : {}),
    });
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
  const auth = await requireUser(request, { roles: ["team"], status: 401, write: true });
  if (auth.response) return auth.response;
  const { user } = auth;

  const lockError = await checkEventActive(user.eventId);
  if (lockError) {
    return NextResponse.json({ error: lockError }, { status: 403 });
  }

  try {
    const body = await request.json();
    const countBatch: Array<{
      itemId: number;
      countedQty: number;
      comment?: string | null;
      clientId?: string;
      countedAt?: string;
    }> = body.counts || [];
    const verificationBatch: Array<{
      verificationId: number;
      itemId: number;
      countedQty: number;
      comment?: string | null;
      clientId?: string;
      countedAt?: string;
    }> = body.verificationCounts || [];

    if (!Array.isArray(countBatch) || !Array.isArray(verificationBatch)) {
      return NextResponse.json(
        { error: "counts must be an array" },
        { status: 400 }
      );
    }

    // Results are returned in the same order as the request arrays.
    const results: Array<{ itemId: number; success?: boolean; deduplicated?: boolean; error?: string }> =
      new Array(countBatch.length);
    const verificationResults: Array<{ verificationId: number; success?: boolean; deduplicated?: boolean; error?: string }> = [];

    await db.transaction(async (tx) => {
      // ── Collect all IDs for bulk pre-fetch ──
      const allClientIds = [
        ...countBatch.filter((c) => c.clientId).map((c) => c.clientId!),
        ...verificationBatch.filter((c) => c.clientId).map((c) => c.clientId!),
      ];
      const allItemIds = countBatch.map((c) => c.itemId).filter((id) => typeof id === "number");
      const allVerificationIds = verificationBatch.map((v) => v.verificationId).filter((id) => typeof id === "number");

      // ── Bulk pre-fetch: items for normal counts (locked to serialize with
      //    concurrent single POSTs for the same items) ──
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
          )
          .orderBy(asc(items.id))
          .for("update");
        for (const row of itemRows) {
          itemMap.set(row.id, row);
        }
      }

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

      // ── Order normal counts by countedAt and collapse to the latest per item ──
      const resolvedAt = countBatch.map((c) => resolveCountedAt(c.countedAt));
      const order = countBatch
        .map((_, i) => i)
        .sort((a, b) => resolvedAt[a].localeCompare(resolvedAt[b]));
      const latestIndexByItem = new Map<number, number>();
      for (const i of order) latestIndexByItem.set(countBatch[i].itemId, i);

      // ── Process normal counts (pure in-memory lookups + INSERT/UPDATE) ──
      for (const i of order) {
        const entry = countBatch[i];
        const { itemId, countedQty, comment, clientId } = entry;
        const countedAt = resolvedAt[i];

        if (typeof countedQty !== "number" || isNaN(countedQty) || countedQty < 0) {
          results[i] = { itemId, error: "countedQty must be a non-negative number" };
          continue;
        }

        if (clientId && dedupSet.has(clientId)) {
          results[i] = { itemId, deduplicated: true };
          continue;
        }

        // Superseded by a newer count for the same item in this batch
        if (latestIndexByItem.get(itemId) !== i) {
          results[i] = { itemId, deduplicated: true };
          continue;
        }

        const item = itemMap.get(itemId);
        if (!item) {
          results[i] = { itemId, error: "Not found" };
          continue;
        }

        if (pendingVaSet.has(itemId)) {
          results[i] = { itemId, error: "Pending verification" };
          continue;
        }

        const variance = countedQty - (item.onHand || 0);
        const varianceValue = variance * (item.avgCost || 0);
        const computedIsMatch = variance === 0;

        const existingCount = existingCountMap.get(itemId);

        if (existingCount) {
          if (existingCount.checkStatus === "accepted") {
            results[i] = { itemId, error: "Reviewed by supervisor" };
            continue;
          }

          // Older replay — a newer count is already stored; don't overwrite it
          if (isOlderThan(countedAt, existingCount.countedAt)) {
            results[i] = { itemId, deduplicated: true };
            continue;
          }

          const updatedValues = {
            countedQty,
            variance,
            varianceValue,
            isMatch: computedIsMatch,
            comment: resolveComment(comment, existingCount.comment),
            countedAt,
            syncedAt: new Date().toISOString(),
            clientId: clientId || existingCount.clientId,
          };
          await tx.update(counts)
            .set(updatedValues)
            .where(eq(counts.id, existingCount.id));
          existingCountMap.set(itemId, { ...existingCount, ...updatedValues });
        } else {
          const [inserted] = await tx.insert(counts)
            .values({
              itemId,
              teamId: user.id,
              eventId: user.eventId,
              countedQty,
              variance,
              varianceValue,
              isMatch: computedIsMatch,
              comment: comment || null,
              countedAt,
              syncedAt: new Date().toISOString(),
              clientId: clientId || null,
            })
            .onConflictDoNothing()
            .returning();
          if (!inserted) {
            // clientId inserted concurrently by the immediate POST
            results[i] = { itemId, deduplicated: true };
            continue;
          }
          existingCountMap.set(itemId, inserted);
        }

        if (clientId) dedupSet.add(clientId);
        results[i] = { itemId, success: true };
      }

      // ── Process verification counts (if any) ──
      if (verificationBatch.length > 0) {
        // Bulk pre-fetch: verification assignments (locked, see single POST path)
        const vaMap = new Map<number, typeof verificationAssignments.$inferSelect>();
        if (allVerificationIds.length > 0) {
          const vaRows = await tx
            .select()
            .from(verificationAssignments)
            .where(
              and(
                inArray(verificationAssignments.id, allVerificationIds),
                eq(verificationAssignments.assignedTeamId, user.id),
                eq(verificationAssignments.eventId, user.eventId),
                eq(verificationAssignments.status, "pending")
              )
            )
            .orderBy(asc(verificationAssignments.id))
            .for("update");
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

          const inserted = await tx.insert(counts)
            .values({
              itemId: va.itemId,
              teamId: user.id,
              eventId: user.eventId,
              countedQty,
              variance,
              varianceValue,
              isMatch: computedIsMatch,
              comment: comment || null,
              countedAt: resolveCountedAt(entry.countedAt),
              syncedAt: new Date().toISOString(),
              clientId: clientId || null,
              countType: "verification",
              verificationId,
            })
            .onConflictDoNothing()
            .returning({ id: counts.id });

          // Assignment is consumed either way — later entries for it are rejected
          vaMap.delete(verificationId);

          if (inserted.length === 0) {
            verificationResults.push({ verificationId, error: "Assignment already verified" });
            continue;
          }

          await tx.update(verificationAssignments)
            .set({
              status: "completed",
              completedAt: new Date().toISOString(),
            })
            .where(eq(verificationAssignments.id, verificationId));

          if (clientId) dedupSet.add(clientId);
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
