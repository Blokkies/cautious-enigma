import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { teams } from "@/lib/db/schema";
import { eq, and, sql, inArray, type SQL } from "drizzle-orm";
import { getEventWarehouses, requireUser, resolveEventId } from "@/lib/api-auth";
import { NO_BIN } from "@/lib/no-bin";
import { checkEventWritable } from "../event-guard";
import { eventWriteError, lockEventRow, parseEventWarehouses, RouteError, routeErrorResponse, type Tx } from "../event-lock";
import { binNumberExpr, binRefsCondition, itemScopeFragment, parseBinRefs, type BinRef } from "./bins";

/** Optional brand filter from a request body/query ("" / missing = all brands). */
function brandParam(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Condition (no leading AND) selecting a team's items to unassign/move, for the items
 * table under `alias` (e.g. "i"); undefined alias = bare column names.
 */
type ItemMatch = (alias?: string) => SQL;

/** Items in the given bins, within the event's warehouse scope and the optional brand filter. */
function binsMatch(refs: BinRef[], warehouses: string[] | null, brand: string | null): ItemMatch {
  return (alias) => sql`${binRefsCondition(refs, alias)}${itemScopeFragment(warehouses, brand, alias)}`;
}

/**
 * Serial discrepancies carry (team, item code, bin number, bin internal id) but no item id
 * or warehouse. A discrepancy belongs to item `alias` when the item code and bin number
 * match (a NULL discrepancy bin = an item without a bin) and, when both sides have one,
 * the bin internal id (which tells same-numbered bins in different warehouses apart).
 */
function discrepancyMatchesItem(alias: string): SQL {
  const a = (col: string) => sql.raw(`${alias}.${col}`);
  return sql`${a("item_code")} = sd.item_code
    AND (${a("bin_number")} IS NOT DISTINCT FROM sd.bin_number OR (sd.bin_number IS NULL AND ${a("bin_number")} = ${NO_BIN}))
    AND (sd.bin_internal_id IS NULL OR ${a("bin_internal_id")} IS NULL OR ${a("bin_internal_id")} = sd.bin_internal_id)`;
}

/**
 * Delete the counts (and the verification assignments pointing at them) and the serial
 * discrepancies a team recorded for the matched items. `match` null = all of the team's items.
 * Must run before the items are moved/unassigned.
 */
async function clearTeamCountData(tx: Tx, eid: number, tid: number, match: ItemMatch | null) {
  const cond = match ? sql` AND ${match("i")}` : sql``;
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
  // Whole team unassigned: every discrepancy of the team goes.
  if (!match) {
    await tx.execute(sql`DELETE FROM serial_discrepancies WHERE event_id = ${eid} AND team_id = ${tid}`);
    return;
  }
  // Only discrepancies of the cleared items: one must match a cleared item, and must not
  // also match one of the team's items that stays (e.g. the same item code and bin number
  // in another warehouse with no bin internal id to tell them apart) - ambiguous ones are kept.
  await tx.execute(
    sql`DELETE FROM serial_discrepancies sd
        WHERE sd.event_id = ${eid} AND sd.team_id = ${tid}
        AND EXISTS (
          SELECT 1 FROM items i
          WHERE i.event_id = ${eid} AND i.team_id = ${tid}
          AND ${discrepancyMatchesItem("i")}
          AND ${match("i")}
        )
        AND NOT EXISTS (
          SELECT 1 FROM items j
          WHERE j.event_id = ${eid} AND j.team_id = ${tid}
          AND ${discrepancyMatchesItem("j")}
          AND (${match("j")}) IS NOT TRUE
        )`
  );
}

/**
 * Inside the unassign/move transaction: lock the event row and re-check it is writable,
 * build the item condition from its (locked) warehouse selection, then lock the team's matched item rows (team count submissions lock the item row too,
 * so no count can slip in between this check and the move) and count their counts.
 * Throws 409 if there are counts and the caller didn't ask to clear them.
 */
async function lockAndCheckCounts(
  tx: Tx,
  opts: {
    eid: number;
    tid: number;
    userType: string;
    clearCounts: boolean;
    /** Builds the item condition from the event's warehouse selection (null = all the team's items). */
    makeMatch: (warehouses: string[] | null) => ItemMatch | null;
    verb: string;
  }
): Promise<{ countedCount: number; match: ItemMatch | null }> {
  const { eid, tid, userType, clearCounts, makeMatch, verb } = opts;
  const event = await lockEventRow(tx, eid);
  if (!event) throw new RouteError(404, { error: "Event not found" });
  const writeError = eventWriteError(event.status, userType, clearCounts);
  if (writeError) throw new RouteError(403, { error: writeError });
  const match = makeMatch(parseEventWarehouses(event.warehouses));

  const cond = match ? sql` AND ${match("i")}` : sql``;
  await tx.execute(sql`SELECT i.id FROM items i WHERE i.event_id = ${eid} AND i.team_id = ${tid}${cond} FOR UPDATE`);
  const countedCheck = (await tx.execute(
    sql`SELECT count(*)::int as cnt FROM counts c
        JOIN items i ON i.id = c.item_id
        WHERE i.event_id = ${eid} AND i.team_id = ${tid}${cond}`
  )) as { cnt: number }[];
  const countedCount = Number(countedCheck[0]?.cnt) || 0;
  if (countedCount > 0 && !clearCounts) {
    throw new RouteError(409, { error: `Cannot ${verb} bins that have counted items`, hasCountedItems: true, countedCount });
  }
  return { countedCount, match };
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
    const ref: BinRef = warehouse !== null ? { warehouse, bin: binNumber } : { bin: binNumber };
    const binItems = await db.execute(
      sql`SELECT id, item_code, description, brand, warehouse, on_hand, total_value, stock_status, serial_number
         FROM items WHERE event_id = ${eid} AND ${binRefsCondition([ref])} AND team_id IS NULL${itemScopeFragment(eventWarehouses, brand)}
         ORDER BY item_code`
    );
    return NextResponse.json({ binItems });
  }

  const whFragment = itemScopeFragment(eventWarehouses);
  const scope = itemScopeFragment(eventWarehouses, brand);

  // Unassigned bins, keyed by (warehouse, bin_number). Every in-scope item is listed (blank
  // bins as NO_BIN), so this always agrees with the activation readiness check.
  const unassignedBinsRaw = await db.execute(
    sql`SELECT warehouse, ${binNumberExpr()} AS bin_number, count(*) as item_count, COALESCE(sum(total_value), 0) as total_value
       FROM items WHERE event_id = ${eid} AND team_id IS NULL${scope}
       GROUP BY 1, 2 ORDER BY 2, 1`
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
        sql`SELECT i.warehouse, ${binNumberExpr("i")} AS bin_number, count(*)::int as item_count, COALESCE(sum(i.total_value), 0) as total_value,
               count(c.id)::int as counted_items
           FROM items i
           LEFT JOIN counts c ON c.item_id = i.id AND c.count_type = 'initial'
           WHERE i.event_id = ${eid} AND i.team_id = ${team.id}${teamScope}
           GROUP BY 1, 2 ORDER BY 2, 1`
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

// DELETE: Unassign items of a team.
// - bins: [{ warehouse, bin }] (legacy: bin-number strings) unassigns those bins, limited to
//   the event's warehouse selection and the optional `brand` filter.
// - all: true (and no bins) unassigns every item of the team.
// A missing/empty/malformed bins list without `all: true` is rejected, so a bad request
// can never unassign (and with clearCounts, wipe the counts of) a whole team.
export async function DELETE(request: NextRequest) {
  const auth = await requireUser(request, { roles: ["admin", "supervisor"], write: true });
  if (auth.response) return auth.response;
  const { user } = auth;

  try {
    const body = await request.json();
    const eid = resolveEventId(user, body.eventId);
    const { teamId } = body;
    const clearCounts = body.clearCounts === true;

    if (!eid || !teamId) {
      return NextResponse.json(
        { error: "eventId and teamId required" },
        { status: 400 }
      );
    }

    const all = body.all === true;
    let refs: BinRef[] | null = null;
    if (all) {
      if (body.bins !== undefined && body.bins !== null) {
        return NextResponse.json({ error: "Send either bins or all: true, not both" }, { status: 400 });
      }
    } else {
      refs = parseBinRefs(body.bins);
      if (!refs || refs.length === 0) {
        return NextResponse.json(
          { error: "A non-empty bins[] is required (or all: true to unassign every bin of the team)" },
          { status: 400 }
        );
      }
    }

    const guard = await checkEventWritable(eid, user.type, clearCounts);
    if (guard) return NextResponse.json({ error: guard }, { status: guard === "Event not found" ? 404 : 403 });

    const tid = Number(teamId);
    const brand = refs ? brandParam(body.brand) : null;

    const countedCount = await db.transaction(async (tx) => {
      const { countedCount, match } = await lockAndCheckCounts(tx, {
        eid,
        tid,
        userType: user.type,
        clearCounts,
        makeMatch: (warehouses) => (refs ? binsMatch(refs, warehouses, brand) : null),
        verb: "unassign",
      });

      if (clearCounts) {
        await clearTeamCountData(tx, eid, tid, match);
      }
      const cond = match ? sql` AND ${match()}` : sql``;
      await tx.execute(
        sql`UPDATE items SET team_id = NULL WHERE event_id = ${eid} AND team_id = ${tid}${cond}`
      );
      return countedCount;
    });

    return NextResponse.json({ success: true, clearedCounts: clearCounts ? countedCount : 0 });
  } catch (error) {
    const routeError = routeErrorResponse(error);
    if (routeError) return routeError;
    console.error("Unassign error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// PATCH: Re-assign bins from one team to another (optional `brand` filter), limited to
// the event's warehouse selection.
export async function PATCH(request: NextRequest) {
  const auth = await requireUser(request, { roles: ["admin", "supervisor"], write: true });
  if (auth.response) return auth.response;
  const { user } = auth;

  try {
    const body = await request.json();
    const eid = resolveEventId(user, body.eventId);
    const { fromTeamId, toTeamId } = body;
    const clearCounts = body.clearCounts === true;
    const refs = parseBinRefs(body.bins);

    if (!eid || !fromTeamId || !toTeamId || !refs || refs.length === 0) {
      return NextResponse.json(
        { error: "eventId, fromTeamId, toTeamId, and bins[] required" },
        { status: 400 }
      );
    }

    const guard = await checkEventWritable(eid, user.type, clearCounts);
    if (guard) return NextResponse.json({ error: guard }, { status: guard === "Event not found" ? 404 : 403 });

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
    const match = (warehouses: string[] | null) => binsMatch(refs, warehouses, brand);

    // Check counts, delete counts + verifications + serial discrepancies, then move items,
    // all in one transaction
    const { result, countedCount } = await db.transaction(async (tx) => {
      const locked = await lockAndCheckCounts(tx, {
        eid,
        tid: fromId,
        userType: user.type,
        clearCounts,
        makeMatch: match,
        verb: "re-assign",
      });
      const itemMatch = locked.match!;

      if (clearCounts) {
        await clearTeamCountData(tx, eid, fromId, itemMatch);
      }

      const result = await tx.execute(
        sql`UPDATE items SET team_id = ${Number(toTeamId)}
            WHERE event_id = ${eid} AND team_id = ${fromId} AND ${itemMatch()} RETURNING id`
      );
      return { result, countedCount: locked.countedCount };
    });

    return NextResponse.json({ success: true, movedCount: result.length, clearedCounts: clearCounts ? countedCount : 0 });
  } catch (error) {
    const routeError = routeErrorResponse(error);
    if (routeError) return routeError;
    console.error("Re-assign error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
