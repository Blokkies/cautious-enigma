import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { items, teams } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { getEventWarehouses, getApiUser } from "@/lib/api-auth";

function getAuthorizedEventId(request: NextRequest, clientEventId?: number | string | null): number | null {
  const user = getApiUser(request);
  if (!user) return null;
  if (user.type === "admin") return clientEventId ? Number(clientEventId) : null;
  if (user.type === "supervisor" || user.type === "auditor") return user.eventId;
  return null;
}

// GET: Get assignment overview - unassigned bins and per-team bin breakdown
export async function GET(request: NextRequest) {
  const user = getApiUser(request);
  if (!user || (user.type !== "admin" && user.type !== "supervisor" && user.type !== "auditor")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const eid = getAuthorizedEventId(request, request.nextUrl.searchParams.get("eventId"));
  if (!eid) {
    return NextResponse.json({ error: "eventId required" }, { status: 400 });
  }

  // Check for bin items request (Feature 4)
  const binNumber = request.nextUrl.searchParams.get("binNumber");
  if (binNumber) {
    const binItems = await db.execute(
      sql`SELECT id, item_code, description, brand, warehouse, on_hand, total_value, stock_status, serial_number
         FROM items WHERE event_id = ${eid} AND bin_number = ${binNumber} AND team_id IS NULL
         ORDER BY item_code`
    );
    return NextResponse.json({ binItems });
  }

  // Event-level warehouse scoping + brand filter
  const eventWarehouses = await getEventWarehouses(eid);
  const brand = request.nextUrl.searchParams.get("brand");

  // Build warehouse SQL fragment (parameterized)
  const whFragment = eventWarehouses
    ? sql` AND warehouse IN (${sql.join(eventWarehouses.map(w => sql`${w}`), sql`, `)})`
    : sql``;

  // Build unassigned bins query
  let unassignedBinsQuery = sql`SELECT bin_number, count(*) as item_count, COALESCE(sum(total_value), 0) as total_value
     FROM items WHERE event_id = ${eid} AND team_id IS NULL AND bin_number IS NOT NULL${whFragment}`;

  if (brand) {
    unassignedBinsQuery = sql`${unassignedBinsQuery} AND brand = ${brand}`;
  }

  unassignedBinsQuery = sql`${unassignedBinsQuery} GROUP BY bin_number ORDER BY bin_number`;

  const unassignedBinsRaw = await db.execute(unassignedBinsQuery) as { bin_number: string; item_count: string | number; total_value: string | number }[];
  const unassignedBins = unassignedBinsRaw.map(b => ({
    bin_number: b.bin_number,
    item_count: Number(b.item_count),
    total_value: Number(b.total_value),
  }));

  // Brand filter options (scoped to event warehouses)
  let brandFilterQuery = sql`SELECT DISTINCT brand FROM items WHERE event_id = ${eid} AND team_id IS NULL AND brand IS NOT NULL AND brand != ''${whFragment}`;
  brandFilterQuery = sql`${brandFilterQuery} ORDER BY brand`;

  const brandsResult = await db.execute(brandFilterQuery) as { brand: string }[];
  const brands = brandsResult.map(r => r.brand);

  // Summary stats - scoped to event warehouses + brand filter
  let statsQuery = sql`SELECT count(*) as count FROM items WHERE event_id = ${eid}${whFragment}`;
  if (brand) {
    statsQuery = sql`${statsQuery} AND brand = ${brand}`;
  }

  const totalItemsResult = await db.execute(statsQuery);
  const totalItems = Number((totalItemsResult[0] as Record<string, unknown>)?.count ?? 0);

  let assignedQuery = sql`SELECT count(*) as count FROM items WHERE event_id = ${eid} AND team_id IS NOT NULL${whFragment}`;
  if (brand) {
    assignedQuery = sql`${assignedQuery} AND brand = ${brand}`;
  }

  const assignedItemsResult = await db.execute(assignedQuery);
  const assignedItems = Number((assignedItemsResult[0] as Record<string, unknown>)?.count ?? 0);

  let unassignedQuery = sql`SELECT count(*) as count FROM items WHERE event_id = ${eid} AND team_id IS NULL${whFragment}`;
  if (brand) {
    unassignedQuery = sql`${unassignedQuery} AND brand = ${brand}`;
  }

  const unassignedItemsResult = await db.execute(unassignedQuery);
  const unassignedItems = Number((unassignedItemsResult[0] as Record<string, unknown>)?.count ?? 0);

  // Per-team: bins assigned with item counts - respect filters
  const teamList = await db.select().from(teams).where(eq(teams.eventId, eid));

  const teamDetails = await Promise.all(
    teamList.map(async (team) => {
      let teamBinsQuery = sql`SELECT i.bin_number, count(*)::int as item_count, COALESCE(sum(i.total_value), 0) as total_value,
             count(c.id)::int as counted_items
         FROM items i
         LEFT JOIN counts c ON c.item_id = i.id AND c.count_type = 'initial'
         WHERE i.event_id = ${eid} AND i.team_id = ${team.id} AND i.bin_number IS NOT NULL${whFragment}`;

      if (brand) {
        teamBinsQuery = sql`${teamBinsQuery} AND i.brand = ${brand}`;
      }

      teamBinsQuery = sql`${teamBinsQuery} GROUP BY i.bin_number ORDER BY i.bin_number`;

      const teamBinsRaw = await db.execute(teamBinsQuery) as { bin_number: string; item_count: number; total_value: string | number; counted_items: number }[];
      const teamBins = teamBinsRaw.map(b => ({
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

// POST: Assign bins to a team or auto-balance
export async function POST(request: NextRequest) {
  const user = getApiUser(request);
  if (!user || (user.type !== "admin" && user.type !== "supervisor")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const eid = getAuthorizedEventId(request, body.eventId);

    if (!eid) {
      return NextResponse.json({ error: "eventId required" }, { status: 400 });
    }

    // Auto-balance: assign multiple teams at once in a transaction
    if (body.action === "auto-balance") {
      const { assignments } = body as { assignments: Array<{ teamId: number; bins: string[] }> };
      if (!assignments || !Array.isArray(assignments)) {
        return NextResponse.json({ error: "assignments array required" }, { status: 400 });
      }

      let totalAssigned = 0;
      await db.transaction(async (tx) => {
        for (const { teamId, bins } of assignments) {
          if (!bins || bins.length === 0) continue;
          const binList = sql.join(bins.map((b: string) => sql`${b}`), sql`, `);
          const result = await tx.execute(
            sql`UPDATE items SET team_id = ${teamId} WHERE event_id = ${eid} AND bin_number IN (${binList}) AND team_id IS NULL RETURNING id`
          );
          totalAssigned += result.length;
        }
      });

      return NextResponse.json({ success: true, assignedCount: totalAssigned });
    }

    // Standard single-team assignment
    const { teamId, bins } = body;
    if (!teamId || !bins || !Array.isArray(bins) || bins.length === 0) {
      return NextResponse.json(
        { error: "teamId and bins[] are required" },
        { status: 400 }
      );
    }

    const tid = Number(teamId);
    const binList = sql.join(bins.map((b: string) => sql`${b}`), sql`, `);
    const result = await db.execute(
      sql`UPDATE items SET team_id = ${tid} WHERE event_id = ${eid} AND bin_number IN (${binList}) AND team_id IS NULL RETURNING id`
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

// DELETE: Unassign items - either specific bins or all items from a team
export async function DELETE(request: NextRequest) {
  const user = getApiUser(request);
  if (!user || (user.type !== "admin" && user.type !== "supervisor")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const eid = getAuthorizedEventId(request, body.eventId);
    const { teamId, bins } = body;

    if (!eid || !teamId) {
      return NextResponse.json(
        { error: "eventId and teamId required" },
        { status: 400 }
      );
    }

    const tid = Number(teamId);

    if (bins && Array.isArray(bins) && bins.length > 0) {
      // Unassign specific bins
      const binList = sql.join(bins.map((b: string) => sql`${b}`), sql`, `);
      await db.execute(
        sql`UPDATE items SET team_id = NULL WHERE event_id = ${eid} AND team_id = ${tid} AND bin_number IN (${binList})`
      );
    } else {
      // Unassign all items from this team
      await db
        .update(items)
        .set({ teamId: null })
        .where(
          and(eq(items.eventId, eid), eq(items.teamId, tid))
        );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Unassign error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// PATCH: Re-assign uncounted bins from one team to another
export async function PATCH(request: NextRequest) {
  const user = getApiUser(request);
  if (!user || (user.type !== "admin" && user.type !== "supervisor")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const eid = getAuthorizedEventId(request, body.eventId);
    const { fromTeamId, toTeamId, bins, clearCounts } = body;

    if (!eid || !fromTeamId || !toTeamId || !bins || !Array.isArray(bins) || bins.length === 0) {
      return NextResponse.json(
        { error: "eventId, fromTeamId, toTeamId, and bins[] required" },
        { status: 400 }
      );
    }

    if (fromTeamId === toTeamId) {
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

    // Check if items in these bins have counts
    const binList = sql.join(bins.map((b: string) => sql`${b}`), sql`, `);
    const countedCheck = await db.execute(
      sql`SELECT count(*)::int as cnt FROM counts c
          JOIN items i ON i.id = c.item_id
          WHERE i.event_id = ${eid} AND i.team_id = ${Number(fromTeamId)}
          AND i.bin_number IN (${binList})`
    ) as { cnt: number }[];

    const countedCount = Number(countedCheck[0]?.cnt) || 0;

    if (countedCount > 0 && !clearCounts) {
      return NextResponse.json(
        { error: "Cannot re-assign bins that have counted items", hasCountedItems: true, countedCount },
        { status: 409 }
      );
    }

    // Delete counts + move items in a transaction to prevent partial state
    const result = await db.transaction(async (tx) => {
      if (countedCount > 0 && clearCounts) {
        await tx.execute(
          sql`DELETE FROM counts WHERE id IN (
            SELECT c.id FROM counts c
            JOIN items i ON i.id = c.item_id
            WHERE i.event_id = ${eid} AND i.team_id = ${Number(fromTeamId)}
            AND i.bin_number IN (${binList})
          )`
        );
      }

      const moved = await tx.execute(
        sql`UPDATE items SET team_id = ${Number(toTeamId)}
            WHERE event_id = ${eid} AND team_id = ${Number(fromTeamId)}
            AND bin_number IN (${binList}) RETURNING id`
      );

      return moved;
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
