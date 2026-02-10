import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { items, teams } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

// GET: Get assignment overview - unassigned bins and per-team bin breakdown
export async function GET(request: NextRequest) {
  const eventId = request.nextUrl.searchParams.get("eventId");
  if (!eventId) {
    return NextResponse.json({ error: "eventId required" }, { status: 400 });
  }

  const eid = Number(eventId);
  const { sqlite } = await import("@/lib/db");

  // Check for bin items request (Feature 4)
  const binNumber = request.nextUrl.searchParams.get("binNumber");
  if (binNumber) {
    const binItems = sqlite
      .prepare(
        `SELECT id, item_code, description, brand, warehouse, on_hand, total_value, stock_status, serial_number
         FROM items WHERE event_id = ? AND bin_number = ? AND team_id IS NULL
         ORDER BY item_code`
      )
      .all(eid, binNumber);
    return NextResponse.json({ binItems });
  }

  // Warehouse and brand filters
  const warehouse = request.nextUrl.searchParams.get("warehouse");
  const brand = request.nextUrl.searchParams.get("brand");

  // Build unassigned bins query with optional filters
  let unassignedBinsQuery = `SELECT bin_number, count(*) as item_count, COALESCE(sum(total_value), 0) as total_value
     FROM items WHERE event_id = ? AND team_id IS NULL AND bin_number IS NOT NULL`;
  const queryParams: (number | string)[] = [eid];

  if (warehouse) {
    unassignedBinsQuery += ` AND warehouse = ?`;
    queryParams.push(warehouse);
  }
  if (brand) {
    unassignedBinsQuery += ` AND brand = ?`;
    queryParams.push(brand);
  }

  unassignedBinsQuery += ` GROUP BY bin_number ORDER BY bin_number`;

  const unassignedBins = sqlite
    .prepare(unassignedBinsQuery)
    .all(...queryParams) as { bin_number: string; item_count: number; total_value: number }[];

  // Filter options - cross-filtered from unassigned items
  let warehouseFilterQuery = `SELECT DISTINCT warehouse FROM items WHERE event_id = ? AND team_id IS NULL AND warehouse IS NOT NULL AND warehouse != ''`;
  const warehouseParams: (number | string)[] = [eid];
  if (brand) {
    warehouseFilterQuery += ` AND brand = ?`;
    warehouseParams.push(brand);
  }
  warehouseFilterQuery += ` ORDER BY warehouse`;

  let brandFilterQuery = `SELECT DISTINCT brand FROM items WHERE event_id = ? AND team_id IS NULL AND brand IS NOT NULL AND brand != ''`;
  const brandParams: (number | string)[] = [eid];
  if (warehouse) {
    brandFilterQuery += ` AND warehouse = ?`;
    brandParams.push(warehouse);
  }
  brandFilterQuery += ` ORDER BY brand`;

  const warehouses = (sqlite.prepare(warehouseFilterQuery).all(...warehouseParams) as { warehouse: string }[]).map(r => r.warehouse);
  const brands = (sqlite.prepare(brandFilterQuery).all(...brandParams) as { brand: string }[]).map(r => r.brand);

  // Summary stats - respect filters
  let statsFilter = `WHERE event_id = ?`;
  const statsParams: (number | string)[] = [eid];
  if (warehouse) {
    statsFilter += ` AND warehouse = ?`;
    statsParams.push(warehouse);
  }
  if (brand) {
    statsFilter += ` AND brand = ?`;
    statsParams.push(brand);
  }

  const totalItems = sqlite
    .prepare(`SELECT count(*) as count FROM items ${statsFilter}`)
    .get(...statsParams) as { count: number } | undefined;

  const assignedItems = sqlite
    .prepare(`SELECT count(*) as count FROM items ${statsFilter} AND team_id IS NOT NULL`)
    .get(...statsParams) as { count: number } | undefined;

  const unassignedItems = sqlite
    .prepare(`SELECT count(*) as count FROM items ${statsFilter} AND team_id IS NULL`)
    .get(...statsParams) as { count: number } | undefined;

  // Per-team: bins assigned with item counts - respect filters
  const teamList = db.select().from(teams).where(eq(teams.eventId, eid)).all();

  // Build filter clause for team queries
  let teamFilterClause = "";
  const teamFilterParams: string[] = [];
  if (warehouse) {
    teamFilterClause += ` AND warehouse = ?`;
    teamFilterParams.push(warehouse);
  }
  if (brand) {
    teamFilterClause += ` AND brand = ?`;
    teamFilterParams.push(brand);
  }

  const teamDetails = teamList.map((team) => {
    const teamBins = sqlite
      .prepare(
        `SELECT bin_number, count(*) as item_count, COALESCE(sum(total_value), 0) as total_value
         FROM items WHERE event_id = ? AND team_id = ? AND bin_number IS NOT NULL${teamFilterClause}
         GROUP BY bin_number ORDER BY bin_number`
      )
      .all(eid, team.id, ...teamFilterParams) as { bin_number: string; item_count: number; total_value: number }[];

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
  });

  return NextResponse.json({
    unassignedBins,
    filterOptions: { warehouses, brands },
    stats: {
      total: totalItems?.count || 0,
      assigned: assignedItems?.count || 0,
      unassigned: unassignedItems?.count || 0,
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
    const { sqlite } = await import("@/lib/db");

    // Auto-balance: assign multiple teams at once in a transaction
    if (action === "auto-balance") {
      const { assignments } = body as { assignments: Array<{ teamId: number; bins: string[] }> };
      if (!assignments || !Array.isArray(assignments)) {
        return NextResponse.json({ error: "assignments array required" }, { status: 400 });
      }

      let totalAssigned = 0;
      const runInTransaction = sqlite.transaction(() => {
        for (const { teamId, bins } of assignments) {
          if (!bins || bins.length === 0) continue;
          const placeholders = bins.map(() => "?").join(",");
          const result = sqlite
            .prepare(
              `UPDATE items SET team_id = ? WHERE event_id = ? AND bin_number IN (${placeholders}) AND team_id IS NULL`
            )
            .run(teamId, eid, ...bins);
          totalAssigned += result.changes;
        }
      });
      runInTransaction();

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
    const placeholders = bins.map(() => "?").join(",");
    const result = sqlite
      .prepare(
        `UPDATE items SET team_id = ? WHERE event_id = ? AND bin_number IN (${placeholders}) AND team_id IS NULL`
      )
      .run(tid, eid, ...bins);

    return NextResponse.json({
      success: true,
      assignedCount: result.changes,
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

    const { sqlite } = await import("@/lib/db");

    if (bins && Array.isArray(bins) && bins.length > 0) {
      // Unassign specific bins
      const placeholders = bins.map(() => "?").join(",");
      sqlite
        .prepare(
          `UPDATE items SET team_id = NULL WHERE event_id = ? AND team_id = ? AND bin_number IN (${placeholders})`
        )
        .run(Number(eventId), Number(teamId), ...bins);
    } else {
      // Unassign all items from this team
      db.update(items)
        .set({ teamId: null })
        .where(
          and(eq(items.eventId, Number(eventId)), eq(items.teamId, Number(teamId)))
        )
        .run();
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
