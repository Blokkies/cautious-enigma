import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { items, counts, auditLog, verificationAssignments } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
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
      const [item] = await db
        .select()
        .from(items)
        .where(eq(items.id, itemId));

      if (!item) {
        return NextResponse.json(
          { error: "Item not found" },
          { status: 404 }
        );
      }

      const variance = countedQty - (item.onHand || 0);
      const varianceValue = variance * (item.avgCost || 0);
      const computedIsMatch = variance === 0;

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
    const { counts: countBatch } = await request.json();

    if (!Array.isArray(countBatch)) {
      return NextResponse.json(
        { error: "counts must be an array" },
        { status: 400 }
      );
    }

    const results: Array<{ itemId: number; success?: boolean; deduplicated?: boolean; error?: string }> = [];

    await db.transaction(async (tx) => {
      for (const entry of countBatch) {
        const { itemId, countedQty, comment, clientId } = entry;

        // Validate countedQty is a non-negative number
        if (typeof countedQty !== "number" || isNaN(countedQty) || countedQty < 0) {
          results.push({ itemId, error: "countedQty must be a non-negative number" });
          continue;
        }

        // Dedup check (scoped to this team)
        if (clientId) {
          const [existing] = await tx
            .select()
            .from(counts)
            .where(and(eq(counts.clientId, clientId), eq(counts.teamId, user.id)));

          if (existing) {
            results.push({ itemId, deduplicated: true });
            continue;
          }
        }

        const [item] = await tx
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
          results.push({ itemId, error: "Not found" });
          continue;
        }

        // Block edits when item has pending verification
        const [pendingVaBatch] = await tx
          .select({ id: verificationAssignments.id })
          .from(verificationAssignments)
          .where(
            and(
              eq(verificationAssignments.itemId, itemId),
              eq(verificationAssignments.eventId, user.eventId),
              eq(verificationAssignments.status, "pending")
            )
          );

        if (pendingVaBatch) {
          results.push({ itemId, error: "Pending verification" });
          continue;
        }

        const variance = countedQty - (item.onHand || 0);
        const varianceValue = variance * (item.avgCost || 0);
        const computedIsMatch = variance === 0;

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
          // Skip items reviewed by supervisor
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
    });

    return NextResponse.json({ success: true, results });
  } catch (error) {
    console.error("Batch sync error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
