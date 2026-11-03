import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { serialDiscrepancies, auditLog } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { requireUser } from "@/lib/api-auth";
import { teamEventGate } from "../_lib/event-gate";
import { safeJsonParse } from "@/lib/utils";

interface DiscrepancyInput {
  itemCode?: unknown;
  description?: unknown;
  binNumber?: unknown;
  binInternalId?: unknown;
  unknownSerials?: unknown;
  clientId?: unknown;
}

type DiscrepancyResult =
  | { success: true; id: number; deduplicated?: true }
  | { success: false; error: string };

/** Order- and duplicate-insensitive key for a set of serials. */
function serialSetKey(serials: unknown[]): string {
  return JSON.stringify(Array.from(new Set(serials.map(String))).sort());
}

/**
 * Validate and record one discrepancy. Serialized per (event, team, item) with
 * a transaction-scoped advisory lock so concurrent replays (immediate POST vs.
 * sync batch) cannot both insert; the (client_id, team_id) unique index backs
 * this up via ON CONFLICT DO NOTHING.
 */
async function recordDiscrepancy(
  user: { id: number; eventId: number },
  entry: DiscrepancyInput
): Promise<DiscrepancyResult> {
  const { itemCode, description, binNumber, binInternalId, unknownSerials } = entry;
  const clientId = typeof entry.clientId === "string" && entry.clientId ? entry.clientId : null;

  if (!itemCode || typeof itemCode !== "string") {
    return { success: false, error: "itemCode is required" };
  }
  if (!Array.isArray(unknownSerials) || unknownSerials.length === 0) {
    return { success: false, error: "unknownSerials must be a non-empty array" };
  }

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(${user.eventId}::int, hashtext(${`serial-disc:${user.id}:${itemCode}`}::text))`
    );

    if (clientId) {
      // Exact replay of this submission
      const [byClient] = await tx
        .select({ id: serialDiscrepancies.id })
        .from(serialDiscrepancies)
        .where(and(eq(serialDiscrepancies.clientId, clientId), eq(serialDiscrepancies.teamId, user.id)));
      if (byClient) return { success: true, id: byClient.id, deduplicated: true } as const;

      // Same serials already reported for this item by this team (e.g. a
      // legacy row without client_id, or the serials sent in another order)
      const sameItem = await tx
        .select({ id: serialDiscrepancies.id, unknownSerials: serialDiscrepancies.unknownSerials })
        .from(serialDiscrepancies)
        .where(
          and(
            eq(serialDiscrepancies.eventId, user.eventId),
            eq(serialDiscrepancies.teamId, user.id),
            eq(serialDiscrepancies.itemCode, itemCode)
          )
        );
      const key = serialSetKey(unknownSerials);
      const match = sameItem.find((row) => serialSetKey(safeJsonParse<unknown[]>(row.unknownSerials, [])) === key);
      if (match) return { success: true, id: match.id, deduplicated: true } as const;
    }

    const inserted = await tx
      .insert(serialDiscrepancies)
      .values({
        eventId: user.eventId,
        teamId: user.id,
        itemCode,
        description: typeof description === "string" && description ? description : null,
        binNumber: typeof binNumber === "string" && binNumber ? binNumber : null,
        binInternalId: typeof binInternalId === "string" && binInternalId ? binInternalId : null,
        unknownSerials: JSON.stringify(unknownSerials),
        status: "open",
        clientId,
      })
      .onConflictDoNothing()
      .returning({ id: serialDiscrepancies.id });

    if (inserted.length > 0) return { success: true, id: inserted[0].id } as const;

    // Unique (client_id, team_id) hit by a concurrent request
    const [existing] = clientId
      ? await tx
          .select({ id: serialDiscrepancies.id })
          .from(serialDiscrepancies)
          .where(and(eq(serialDiscrepancies.clientId, clientId), eq(serialDiscrepancies.teamId, user.id)))
      : [];
    if (existing) return { success: true, id: existing.id, deduplicated: true } as const;
    throw new Error("Serial discrepancy insert conflicted without a matching client_id");
  });
}

export async function POST(request: NextRequest) {
  const auth = await requireUser(request, { roles: ["team"], status: 401, write: true });
  if (auth.response) return auth.response;
  const { user } = auth;

  const gate = await teamEventGate(user.eventId);
  if (gate) return gate;

  try {
    const body = await request.json();

    // ── Batch mode: process array of discrepancies in one request ──
    if (Array.isArray(body.batch)) {
      const batchResults: DiscrepancyResult[] = [];
      for (const entry of body.batch) {
        batchResults.push(await recordDiscrepancy(user, entry ?? {}));
      }
      return NextResponse.json({ success: true, results: batchResults });
    }

    // ── Single-item mode (backwards compatible) ──
    const result = await recordDiscrepancy(user, body ?? {});
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json(result);
  } catch (error) {
    console.error("Serial discrepancy creation error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireUser(request, { roles: ["team"], status: 401, write: true });
  if (auth.response) return auth.response;
  const { user } = auth;

  const gate = await teamEventGate(user.eventId);
  if (gate) return gate;

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

    if (disc.status !== "open") {
      return NextResponse.json({ error: "Discrepancy is no longer open" }, { status: 409 });
    }

    if (disc.verificationStatus !== "pending") {
      return NextResponse.json({ error: "Verification is not pending" }, { status: 400 });
    }

    // Validate all unknown serials are accounted for
    const unknowns = safeJsonParse<string[]>(disc.unknownSerials, []);
    const verifiedSerialSet = new Set(verifiedSerials.map((v) => v.serial));
    const missingSerials = unknowns.filter((s) => !verifiedSerialSet.has(s));
    if (missingSerials.length > 0) {
      return NextResponse.json(
        { error: `Missing verification for serials: ${missingSerials.join(", ")}` },
        { status: 400 }
      );
    }

    // Update discrepancy (conditional on still being open + pending to avoid races)
    const updated = await db.update(serialDiscrepancies)
      .set({
        verificationStatus: "completed",
        verifiedSerials: JSON.stringify(verifiedSerials),
        verificationCompletedAt: new Date().toISOString(),
      })
      .where(
        and(
          eq(serialDiscrepancies.id, discrepancyId),
          eq(serialDiscrepancies.status, "open"),
          eq(serialDiscrepancies.verificationStatus, "pending")
        )
      )
      .returning({ id: serialDiscrepancies.id });

    if (updated.length === 0) {
      return NextResponse.json({ error: "Verification is no longer pending" }, { status: 409 });
    }

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
