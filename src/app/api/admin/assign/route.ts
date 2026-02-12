import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { items, teams } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";

// GET: Get assignment overview - unassigned bins and per-team bin breakdown
export async function GET(request: NextRequest) {
  const eventId = request.nextUrl.searchParams.get("eventId");
  if (!eventId) {
    return NextResponse.json({ error: "eventId required" }, { status: 400 });
  }

  const eid = Number(eventId);

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

  // Warehouse and brand filters
  const warehouse = request.nextUrl.searchParams.get("warehouse");
  const brand = request.nextUrl.searchParams.get("brand");

  // Build unassigned bins query with optional filters
  let unassignedBinsQuery = sql`SELECT bin_number, count(*) as item_count, COALESCE(sum(total_value), 0) as total_value
     FROM items WHERE event_id = ${eid} AND team_id IS NULL AND bin_number IS NOT NULL`;

  if (warehouse) {
    unassignedBinsQuery = sql`${unassignedBinsQuery} AND warehouse = ${warehouse}`;
  }
  if (brand) {
    unassignedBinsQuery = sql`${unassignedBinsQuery} AND brand = ${brand}`;
  }

  unassignedBinsQuery = sql`${unassignedBinsQuery} GROUP BY bin_number ORDER BY bin_number`;

  const unassignedBins = await db.execute(unassignedBinsQuery) as { bin_number: string; item_count: number; total_value: number }[];

  // Filter options - cross-filtered from unassigned items
  let warehouseFilterQuery = sql`SELECT DISTINCT warehouse FROM items WHERE event_id = ${eid} AND team_id IS NULL AND warehouse IS NOT NULL AND warehouse != ''`;
  if (brand) {
    warehouseFilterQuery = sql`${warehouseFilterQuery} AND brand = ${brand}`;
  }
  warehouseFilterQuery = sql`${warehouseFilterQuery} ORDER BY warehouse`;

  let brandFilterQuery = sql`SELECT DISTINCT brand FROM items WHERE event_id = ${eid} AND team_id IS NULL AND brand IS NOT NULL AND brand != ''`;
  if (warehouse) {
    brandFilterQuery = sql`${brandFilterQuery} AND warehouse = ${warehouse}`;
  }
  brandFilterQuery = sql`${brandFilterQuery} ORDER BY brand`;

  const warehousesResult = await db.execute(warehouseFilterQuery) as { warehouse: string }[];
  const brandsResult = await db.execute(brandFilterQuery) as { brand: string }[];
  const warehouses = warehousesResult.map(r => r.warehouse);
  const brands = brandsResult.map(r => r.brand);

  // Summary stats - respect filters
  let statsQuery = sql`SELECT count(*) as count FROM items WHERE event_id = ${eid}`;
  if (warehouse) {
    statsQuery = sql`${statsQuery} AND warehouse = ${warehouse}`;
  }
  if (brand) {
    statsQuery = sql`${statsQuery} AND brand = ${brand}`;
  }

  const totalItemsResult = await db.execute(statsQuery);
  const totalItems = Number((totalItemsResult[0] as Record<string, unknown>)?.count ?? 0);

  let assignedQuery = sql`SELECT count(*) as count FROM items WHERE event_id = ${eid} AND team_id IS NOT NULL`;
  if (warehouse) {
    assignedQuery = sql`${assignedQuery} AND warehouse = ${warehouse}`;
  }
  if (brand) {
    assignedQuery = sql`${assignedQuery} AND brand = ${brand}`;
  }

  const assignedItemsResult = await db.execute(assignedQuery);
  const assignedItems = Number((assignedItemsResult[0] as Record<string, unknown>)?.count ?? 0);

  let unassignedQuery = sql`SELECT count(*) as count FROM items WHERE event_id = ${eid} AND team_id IS NULL`;
  if (warehouse) {
    unassignedQuery = sql`${unassignedQuery} AND warehouse = ${warehouse}`;
  }
  if (brand) {
    unassignedQuery = sql`${unassignedQuery} AND brand = ${brand}`;
  }

  const unassignedItemsResult = await db.execute(unassignedQuery);
  const unassignedItems = Number((unassignedItemsResult[0] as Record<string, unknown>)?.count ?? 0);

  // Per-team: bins assigned with item counts - respect filters
  const teamList = await db.select().from(teams).where(eq(teams.eventId, eid));

  const teamDetails = await Promise.all(
    teamList.map(async (team) => {
      let teamBinsQuery = sql`SELECT bin_number, count(*) as item_count, COALESCE(sum(total_value), 0) as total_value
         FROM items WHERE event_id = ${eid} AND team_id = ${team.id} AND bin_number IS NOT NULL`;

      if (warehouse) {
        teamBinsQuery = sql`${teamBinsQuery} AND warehouse = ${warehouse}`;
      }
      if (brand) {
        teamBinsQuery = sql`${teamBinsQuery} AND brand = ${brand}`;
      }

      teamBinsQuery = sql`${teamBinsQuery} GROUP BY bin_number ORDER BY bin_number`;

      const teamBins = await db.execute(teamBinsQuery) as { bin_number: string; item_count: number; total_value: number }[];

      const totalCount = teamBins.reduce((s, b) => s + b.item_count, 0);
      const totalValue = teamBins.reduce((s, b) => s + b.total_value, 0);

      return {
        id: team.id,
        name: team.name,
        member1: team.member1,
        member2: team.member2,
        itemCount: totalCount,
        totalValue,
        bins: teamBins,
      };
    })
  );

  return NextResponse.json({
    unassignedBins,
    filterOptions: { warehouses, brands },
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
  try {
    const body = await request.json();
    const { eventId, action } = body;

    if (!eventId) {
      return NextResponse.json({ error: "eventId required" }, { status: 400 });
    }

    const eid = Number(eventId);

    // Auto-balance: assign multiple teams at once in a transaction
    if (action === "auto-balance") {
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
  try {
    const { eventId, teamId, bins } = await request.json();

    if (!eventId || !teamId) {
      return NextResponse.json(
        { error: "eventId and teamId required" },
        { status: 400 }
      );
    }

    const eid = Number(eventId);
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
