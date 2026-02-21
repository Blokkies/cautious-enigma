import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { serialDiscrepancies, auditLog } from "@/lib/db/schema";
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

    // ── Batch mode: process array of discrepancies in one request ──
    if (Array.isArray(body.batch)) {
      const batchResults: Array<{ success: boolean; id?: number; deduplicated?: boolean; error?: string }> = [];

      for (const entry of body.batch) {
        const { itemCode, description, binNumber, binInternalId, unknownSerials, clientId } = entry;

        if (!itemCode) {
          batchResults.push({ success: false, error: "itemCode is required" });
          continue;
        }

        if (!unknownSerials || !Array.isArray(unknownSerials) || unknownSerials.length === 0) {
          batchResults.push({ success: false, error: "unknownSerials must be a non-empty array" });
          continue;
        }

        // Dedup check
        if (clientId) {
          const existing = await db
            .select({ id: serialDiscrepancies.id })
            .from(serialDiscrepancies)
            .where(
              and(
                eq(serialDiscrepancies.eventId, user.eventId),
                eq(serialDiscrepancies.teamId, user.id),
                eq(serialDiscrepancies.itemCode, itemCode),
                eq(serialDiscrepancies.unknownSerials, JSON.stringify(unknownSerials))
              )
            );
          if (existing.length > 0) {
            batchResults.push({ success: true, id: existing[0].id, deduplicated: true });
            continue;
          }
        }

        const [{ id }] = await db
          .insert(serialDiscrepancies)
          .values({
            eventId: user.eventId,
            teamId: user.id,
            itemCode,
            description: description || null,
            binNumber: binNumber || null,
            binInternalId: binInternalId || null,
            unknownSerials: JSON.stringify(unknownSerials),
            status: "open",
          })
          .returning({ id: serialDiscrepancies.id });

        batchResults.push({ success: true, id });
      }

      return NextResponse.json({ success: true, results: batchResults });
    }

    // ── Single-item mode (backwards compatible) ──
    const { itemCode, description, binNumber, binInternalId, unknownSerials, clientId } = body;

    if (!itemCode) {
      return NextResponse.json(
        { error: "itemCode is required" },
        { status: 400 }
      );
    }

    if (!unknownSerials || !Array.isArray(unknownSerials) || unknownSerials.length === 0) {
      return NextResponse.json(
        { error: "unknownSerials must be a non-empty array" },
        { status: 400 }
      );
    }

    // Dedup check: if clientId provided, check for existing record from this team
    if (clientId) {
      const existing = await db
        .select({ id: serialDiscrepancies.id })
        .from(serialDiscrepancies)
        .where(
          and(
            eq(serialDiscrepancies.eventId, user.eventId),
            eq(serialDiscrepancies.teamId, user.id),
            eq(serialDiscrepancies.itemCode, itemCode),
            eq(serialDiscrepancies.unknownSerials, JSON.stringify(unknownSerials))
          )
        );
      if (existing.length > 0) {
        return NextResponse.json({ success: true, id: existing[0].id, deduplicated: true });
      }
    }

    const [{ id }] = await db
      .insert(serialDiscrepancies)
      .values({
        eventId: user.eventId,
        teamId: user.id,
        itemCode,
        description: description || null,
        binNumber: binNumber || null,
        binInternalId: binInternalId || null,
        unknownSerials: JSON.stringify(unknownSerials),
        status: "open",
      })
      .returning({ id: serialDiscrepancies.id });

    return NextResponse.json({
      success: true,
      id,
    });
  } catch (error) {
    console.error("Serial discrepancy creation error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  const user = getApiUser(request);
  if (!user || user.type !== "team") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const lockError = await checkEventActive(user.eventId);
  if (lockError) {
    return NextResponse.json({ error: lockError }, { status: 403 });
  }

  try {
    const { discrepancyId, verifiedSerials } = await request.json() as {
      discrepancyId: number;
      verifiedSerials: { serial: string; status: "confirmed" | "not_found" }[];
    };

    if (!discrepancyId) {
      return NextResponse.json({ error: "discrepancyId is required" }, { status: 400 });
    }

    if (!Array.isArray(verifiedSerials) || verifiedSerials.length === 0) {
      return NextResponse.json(
        { error: "verifiedSerials must be a non-empty array" },
        { status: 400 }
      );
    }

    // Validate each entry has serial and valid status
    for (const entry of verifiedSerials) {
      if (!entry.serial || !["confirmed", "not_found"].includes(entry.status)) {
        return NextResponse.json(
          { error: "Each entry must have serial and status (confirmed|not_found)" },
          { status: 400 }
        );
      }
    }

    // Fetch the discrepancy
    const [disc] = await db
      .select()
      .from(serialDiscrepancies)
      .where(
        and(
          eq(serialDiscrepancies.id, discrepancyId),
          eq(serialDiscrepancies.eventId, user.eventId)
        )
      );

    if (!disc) {
      return NextResponse.json({ error: "Discrepancy not found" }, { status: 404 });
    }

    // Validate this discrepancy is assigned to this team and pending
    if (disc.verificationTeamId !== user.id) {
      return NextResponse.json({ error: "Not assigned to your team" }, { status: 403 });
    }

    if (disc.verificationStatus !== "pending") {
      return NextResponse.json({ error: "Verification is not pending" }, { status: 400 });
    }

    // Validate all unknown serials are accounted for
    const unknowns: string[] = JSON.parse(disc.unknownSerials);
    const verifiedSerialSet = new Set(verifiedSerials.map((v) => v.serial));
    const missingSerials = unknowns.filter((s) => !verifiedSerialSet.has(s));
    if (missingSerials.length > 0) {
      return NextResponse.json(
        { error: `Missing verification for serials: ${missingSerials.join(", ")}` },
        { status: 400 }
      );
    }

    // Update discrepancy
    await db.update(serialDiscrepancies)
      .set({
        verificationStatus: "completed",
        verifiedSerials: JSON.stringify(verifiedSerials),
        verificationCompletedAt: new Date().toISOString(),
      })
      .where(eq(serialDiscrepancies.id, discrepancyId));

    // Audit log
    await db.insert(auditLog)
      .values({
        eventId: user.eventId,
        userId: user.id,
        userType: "team",
        action: "serial_verification_completed",
        tableName: "serial_discrepancies",
        recordId: discrepancyId,
        newValue: JSON.stringify(verifiedSerials),
      });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Serial verification submission error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
