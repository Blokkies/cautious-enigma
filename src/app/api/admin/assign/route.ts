import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { items, teams } from "@/lib/db/schema";
import { eq, and, sql, inArray, type SQL } from "drizzle-orm";
import { getEventWarehouses, requireUser, resolveEventId } from "@/lib/api-auth";
import { checkEventWritable } from "../event-guard";
import type { Tx } from "../event-lock";
import { binRefsCondition, itemScopeFragment, parseBinRefs, type BinRef } from "./bins";

/** Optional brand filter from a request body/query ("" / missing = all brands). */
function brandParam(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Delete the counts (and the verification assignments pointing at them) and the serial
 * discrepancies a team recorded for the matched items. `itemCond` (" AND ...") filters
 * `items i`; null = all of the team's items.
 * Must run before the items are moved/unassigned.
 */
async function clearTeamCountData(tx: Tx, eid: number, tid: number, itemCond: SQL | null) {
  const cond = itemCond ?? sql``;
  await tx.execute(
    sql`DELETE FROM verification_assignments WHERE count_id IN (
      SELECT c.id FROM counts c
      JOIN items i ON i.id = c.item_id
      WHERE i.event_id = ${eid} AND i.team_id = ${tid}${cond}
    )`
  );
  await tx.execute(
    sql`DELETE FROM counts WHERE id IN (
      SELECT c.id FROM counts c
      JOIN items i ON i.id = c.item_id
      WHERE i.event_id = ${eid} AND i.team_id = ${tid}${cond}
    )`
  );
  // Serial discrepancies are keyed by (team, item code, bin) rather than item id.
  // Without a bin filter (whole team unassigned) every discrepancy of the team goes.
  if (!itemCond) {
    await tx.execute(sql`DELETE FROM serial_discrepancies WHERE event_id = ${eid} AND team_id = ${tid}`);
    return;
  }
  await tx.execute(
    sql`DELETE FROM serial_discrepancies sd
        WHERE sd.event_id = ${eid} AND sd.team_id = ${tid}
        AND EXISTS (
          SELECT 1 FROM items i
          WHERE i.event_id = ${eid} AND i.team_id = ${tid}
          AND i.item_code = sd.item_code
          AND i.bin_number IS NOT DISTINCT FROM sd.bin_number${itemCond}
        )`
  );
}

// GET: Get assignment overview - unassigned bins and per-team bin breakdown
export async function GET(request: NextRequest) {
  const auth = await requireUser(request, { roles: ["admin", "supervisor", "auditor"] });
  if (auth.response) return auth.response;
  const { user } = auth;

  const eid = resolveEventId(user, request.nextUrl.searchParams.get("eventId"));
  if (!eid) {
    return NextResponse.json({ error: "eventId required" }, { status: 400 });
  }

  // Event-level warehouse scoping + brand filter
  const eventWarehouses = await getEventWarehouses(eid);
  const brand = brandParam(request.nextUrl.searchParams.get("brand"));

  // Items of one unassigned bin (bin = warehouse + bin number)
  const binNumber = request.nextUrl.searchParams.get("binNumber");
  if (binNumber) {
    const warehouse = request.nextUrl.searchParams.get("warehouse");
    const whCond = warehouse !== null ? sql` AND COALESCE(warehouse, '') = ${warehouse}` : sql``;
    const binItems = await db.execute(
      sql`SELECT id, item_code, description, brand, warehouse, on_hand, total_value, stock_status, serial_number
         FROM items WHERE event_id = ${eid} AND bin_number = ${binNumber}${whCond} AND team_id IS NULL${itemScopeFragment(eventWarehouses, brand)}
         ORDER BY item_code`
    );
    return NextResponse.json({ binItems });
  }

  const whFragment = itemScopeFragment(eventWarehouses);
  const scope = itemScopeFragment(eventWarehouses, brand);

  // Unassigned bins, keyed by (warehouse, bin_number)
  const unassignedBinsRaw = await db.execute(
    sql`SELECT warehouse, bin_number, count(*) as item_count, COALESCE(sum(total_value), 0) as total_value
       FROM items WHERE event_id = ${eid} AND team_id IS NULL AND bin_number IS NOT NULL${scope}
       GROUP BY warehouse, bin_number ORDER BY bin_number, warehouse`
  ) as { warehouse: string | null; bin_number: string; item_count: string | number; total_value: string | number }[];
  const unassignedBins = unassignedBinsRaw.map(b => ({
    warehouse: b.warehouse,
    bin_number: b.bin_number,
    item_count: Number(b.item_count),
    total_value: Number(b.total_value),
  }));

  // Brand filter options (scoped to event warehouses)
  const brandsResult = await db.execute(
    sql`SELECT DISTINCT brand FROM items WHERE event_id = ${eid} AND team_id IS NULL AND brand IS NOT NULL AND brand != ''${whFragment} ORDER BY brand`
  ) as { brand: string }[];
  const brands = brandsResult.map(r => r.brand);

  // Summary stats - scoped to event warehouses + brand filter
  const totalItemsResult = await db.execute(sql`SELECT count(*) as count FROM items WHERE event_id = ${eid}${scope}`);
  const totalItems = Number((totalItemsResult[0] as Record<string, unknown>)?.count ?? 0);

  const assignedItemsResult = await db.execute(sql`SELECT count(*) as count FROM items WHERE event_id = ${eid} AND team_id IS NOT NULL${scope}`);
  const assignedItems = Number((assignedItemsResult[0] as Record<string, unknown>)?.count ?? 0);

  const unassignedItemsResult = await db.execute(sql`SELECT count(*) as count FROM items WHERE event_id = ${eid} AND team_id IS NULL${scope}`);
  const unassignedItems = Number((unassignedItemsResult[0] as Record<string, unknown>)?.count ?? 0);

  // Per-team: bins assigned with item counts - respect filters
  const teamList = await db.select().from(teams).where(eq(teams.eventId, eid));
  const teamScope = itemScopeFragment(eventWarehouses, brand, "i");

  const teamDetails = await Promise.all(
    teamList.map(async (team) => {
      const teamBinsRaw = await db.execute(
        sql`SELECT i.warehouse, i.bin_number, count(*)::int as item_count, COALESCE(sum(i.total_value), 0) as total_value,
               count(c.id)::int as counted_items
           FROM items i
           LEFT JOIN counts c ON c.item_id = i.id AND c.count_type = 'initial'
           WHERE i.event_id = ${eid} AND i.team_id = ${team.id} AND i.bin_number IS NOT NULL${teamScope}
           GROUP BY i.warehouse, i.bin_number ORDER BY i.bin_number, i.warehouse`
      ) as { warehouse: string | null; bin_number: string; item_count: number; total_value: string | number; counted_items: number }[];
      const teamBins = teamBinsRaw.map(b => ({
        warehouse: b.warehouse,
        bin_number: b.bin_number,
        item_count: Number(b.item_count),
        total_value: Number(b.total_value),
        counted_items: Number(b.counted_items),
      }));

      const totalCount = teamBins.reduce((s, b) => s + b.item_count, 0);
      const totalValue = teamBins.reduce((s, b) => s + b.total_value, 0);

      return {
        id: team.id,
        name: team.name,
        members: team.members,
        itemCount: totalCount,
        totalValue,
        bins: teamBins,
      };
    })
  );

  return NextResponse.json({
    unassignedBins,
    filterOptions: { brands },
    stats: {
      total: totalItems,
      assigned: assignedItems,
      unassigned: unassignedItems,
    },
    teamDetails,
  });
}

// POST: Assign bins to a team or auto-balance.
// bins: [{ warehouse, bin }] (legacy: bin-number strings). Only unassigned items inside
// the event's warehouse scope (and the optional `brand` filter) are assigned.
export async function POST(request: NextRequest) {
  const auth = await requireUser(request, { roles: ["admin", "supervisor"], write: true });
  if (auth.response) return auth.response;
  const { user } = auth;

  try {
    const body = await request.json();
    const eid = resolveEventId(user, body.eventId);

    if (!eid) {
      return NextResponse.json({ error: "eventId required" }, { status: 400 });
    }

    const guard = await checkEventWritable(eid, user.type);
    if (guard) return NextResponse.json({ error: guard }, { status: 403 });

    const scope = itemScopeFragment(await getEventWarehouses(eid), brandParam(body.brand));

    // Auto-balance: assign multiple teams at once in a transaction
    if (body.action === "auto-balance") {
      const rawAssignments = body.assignments as Array<{ teamId: number; bins: unknown }> | undefined;
      if (!rawAssignments || !Array.isArray(rawAssignments)) {
        return NextResponse.json({ error: "assignments array required" }, { status: 400 });
      }
      const assignments: { teamId: number; refs: BinRef[] }[] = [];
      for (const a of rawAssignments) {
        const refs = a.bins === undefined || a.bins === null ? [] : parseBinRefs(a.bins);
        if (!refs) return NextResponse.json({ error: "Invalid bins in assignments" }, { status: 400 });
        assignments.push({ teamId: Number(a.teamId), refs });
      }

      // Validate all teams belong to this event
      const teamIds = assignments.map((a) => a.teamId);
      if (teamIds.length > 0) {
        const validTeams = await db.select({ id: teams.id }).from(teams)
          .where(and(eq(teams.eventId, eid), inArray(teams.id, teamIds)));
        const validTeamIds = new Set(validTeams.map((t) => t.id));
        const invalidTeam = teamIds.find((id) => !validTeamIds.has(id));
        if (invalidTeam) {
          return NextResponse.json({ error: `Team ${invalidTeam} not found in this event` }, { status: 404 });
        }
      }

      let totalAssigned = 0;
      await db.transaction(async (tx) => {
        for (const { teamId, refs } of assignments) {
          if (refs.length === 0) continue;
          const result = await tx.execute(
            sql`UPDATE items SET team_id = ${teamId}
                WHERE event_id = ${eid} AND team_id IS NULL AND ${binRefsCondition(refs)}${scope}
                RETURNING id`
          );
          totalAssigned += result.length;
        }
      });

      return NextResponse.json({ success: true, assignedCount: totalAssigned });
    }

    // Standard single-team assignment
    const { teamId } = body;
    const refs = parseBinRefs(body.bins);
    if (!teamId || !refs || refs.length === 0) {
      return NextResponse.json(
        { error: "teamId and bins[] are required" },
        { status: 400 }
      );
    }

    const tid = Number(teamId);

    // Validate team belongs to this event
    const [targetTeam] = await db.select({ id: teams.id }).from(teams)
      .where(and(eq(teams.id, tid), eq(teams.eventId, eid)));
    if (!targetTeam) {
      return NextResponse.json({ error: "Team not found in this event" }, { status: 404 });
    }

    const result = await db.execute(
      sql`UPDATE items SET team_id = ${tid}
          WHERE event_id = ${eid} AND team_id IS NULL AND ${binRefsCondition(refs)}${scope}
          RETURNING id`
    );

    return NextResponse.json({
      success: true,
      assignedCount: result.length,
    });
  } catch (error) {
    console.error("Assignment error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// DELETE: Unassign items - either specific bins or all items from a team.
// With bins, the optional `brand` filter limits it to that brand's items.
export async function DELETE(request: NextRequest) {
  const auth = await requireUser(request, { roles: ["admin", "supervisor"], write: true });
  if (auth.response) return auth.response;
  const { user } = auth;

  try {
    const body = await request.json();
    const eid = resolveEventId(user, body.eventId);
    const { teamId, clearCounts } = body;

    if (!eid || !teamId) {
      return NextResponse.json(
        { error: "eventId and teamId required" },
        { status: 400 }
      );
    }

    const hasBins = Array.isArray(body.bins) && body.bins.length > 0;
    const refs = hasBins ? parseBinRefs(body.bins) : [];
    if (!refs) {
      return NextResponse.json({ error: "Invalid bins" }, { status: 400 });
    }

    const guard = await checkEventWritable(eid, user.type, !!clearCounts);
    if (guard) return NextResponse.json({ error: guard }, { status: 403 });

    const tid = Number(teamId);
    const brand = hasBins ? brandParam(body.brand) : null;
    // Condition on `items i` (joins) and on bare `items` (UPDATE)
    const itemCondI = hasBins ? sql` AND ${binRefsCondition(refs, "i")}${itemScopeFragment(null, brand, "i")}` : sql``;
    const itemCond = hasBins ? sql` AND ${binRefsCondition(refs)}${itemScopeFragment(null, brand)}` : sql``;

    // Check if items being unassigned have counts (same rule as PATCH)
    const countedCheck = await db.execute(
      sql`SELECT count(*)::int as cnt FROM counts c
          JOIN items i ON i.id = c.item_id
          WHERE i.event_id = ${eid} AND i.team_id = ${tid}${itemCondI}`
    ) as { cnt: number }[];
    const countedCount = Number(countedCheck[0]?.cnt) || 0;

    if (countedCount > 0 && !clearCounts) {
      return NextResponse.json(
        { error: "Cannot unassign bins that have counted items", hasCountedItems: true, countedCount },
        { status: 409 }
      );
    }

    await db.transaction(async (tx) => {
      if (clearCounts) {
        await clearTeamCountData(tx, eid, tid, hasBins ? itemCondI : null);
      }

      if (hasBins) {
        // Unassign specific bins
        await tx.execute(
          sql`UPDATE items SET team_id = NULL WHERE event_id = ${eid} AND team_id = ${tid}${itemCond}`
        );
      } else {
        // Unassign all items from this team
        await tx
          .update(items)
          .set({ teamId: null })
          .where(
            and(eq(items.eventId, eid), eq(items.teamId, tid))
          );
      }
    });

    return NextResponse.json({ success: true, clearedCounts: countedCount > 0 ? countedCount : 0 });
  } catch (error) {
    console.error("Unassign error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// PATCH: Re-assign bins from one team to another (optional `brand` filter)
export async function PATCH(request: NextRequest) {
  const auth = await requireUser(request, { roles: ["admin", "supervisor"], write: true });
  if (auth.response) return auth.response;
  const { user } = auth;

  try {
    const body = await request.json();
    const eid = resolveEventId(user, body.eventId);
    const { fromTeamId, toTeamId, clearCounts } = body;
    const refs = parseBinRefs(body.bins);

    if (!eid || !fromTeamId || !toTeamId || !refs || refs.length === 0) {
      return NextResponse.json(
        { error: "eventId, fromTeamId, toTeamId, and bins[] required" },
        { status: 400 }
      );
    }

    const guard = await checkEventWritable(eid, user.type, !!clearCounts);
    if (guard) return NextResponse.json({ error: guard }, { status: 403 });

    if (Number(fromTeamId) === Number(toTeamId)) {
      return NextResponse.json(
        { error: "Source and target teams must differ" },
        { status: 400 }
      );
    }

    // Validate both teams exist in this event
    const [fromTeam] = await db.select({ id: teams.id }).from(teams)
      .where(and(eq(teams.id, Number(fromTeamId)), eq(teams.eventId, eid)));
    const [toTeam] = await db.select({ id: teams.id }).from(teams)
      .where(and(eq(teams.id, Number(toTeamId)), eq(teams.eventId, eid)));

    if (!fromTeam || !toTeam) {
      return NextResponse.json({ error: "One or both teams not found in this event" }, { status: 404 });
    }

    const fromId = Number(fromTeamId);
    const brand = brandParam(body.brand);
    const itemCondI = sql` AND ${binRefsCondition(refs, "i")}${itemScopeFragment(null, brand, "i")}`;
    const itemCond = sql` AND ${binRefsCondition(refs)}${itemScopeFragment(null, brand)}`;

    // Check if items in these bins have counts
    const countedCheck = await db.execute(
      sql`SELECT count(*)::int as cnt FROM counts c
          JOIN items i ON i.id = c.item_id
          WHERE i.event_id = ${eid} AND i.team_id = ${fromId}${itemCondI}`
    ) as { cnt: number }[];

    const countedCount = Number(countedCheck[0]?.cnt) || 0;

    if (countedCount > 0 && !clearCounts) {
      return NextResponse.json(
        { error: "Cannot re-assign bins that have counted items", hasCountedItems: true, countedCount },
        { status: 409 }
      );
    }

    // Delete counts + verifications + serial discrepancies, then move items, in one transaction
    const result = await db.transaction(async (tx) => {
      if (clearCounts) {
        await clearTeamCountData(tx, eid, fromId, itemCondI);
      }

      return tx.execute(
        sql`UPDATE items SET team_id = ${Number(toTeamId)}
            WHERE event_id = ${eid} AND team_id = ${fromId}${itemCond} RETURNING id`
      );
    });

    return NextResponse.json({ success: true, movedCount: result.length, clearedCounts: countedCount > 0 ? countedCount : 0 });
  } catch (error) {
    console.error("Re-assign error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
