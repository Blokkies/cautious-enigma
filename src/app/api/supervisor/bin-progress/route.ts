import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { teams } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { getApiUser, getEventWarehouses } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
  const user = getApiUser(request);
  if (!user || (user.type !== "supervisor" && user.type !== "admin" && user.type !== "auditor" && user.type !== "executive")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const eid = user.type === "admin"
    ? Number(request.nextUrl.searchParams.get("eventId"))
    : user.eventId;

  if (!eid) {
    return NextResponse.json({ error: "eventId required" }, { status: 400 });
  }

  const brand = request.nextUrl.searchParams.get("brand") || "";

  const eventWarehouses = await getEventWarehouses(eid);
  const whFragment = eventWarehouses
    ? sql` AND i.warehouse IN (${sql.join(eventWarehouses.map(w => sql`${w}`), sql`, `)})`
    : sql``;
  const brandFragment = brand
    ? sql` AND i.brand = ${brand}`
    : sql``;

  // Query distinct brands for filter options
  const brandRows = await db.execute(
    sql`SELECT DISTINCT i.brand FROM items i
        WHERE i.event_id = ${eid} AND i.team_id IS NOT NULL AND i.brand IS NOT NULL AND i.brand != ''${whFragment}
        ORDER BY i.brand`
  ) as { brand: string }[];

  // Single query: per-team, per-bin counts with initial count status
  const rows = await db.execute(
    sql`SELECT i.team_id, i.bin_number,
           count(*)::int as total_items,
           count(c.id)::int as counted_items
         FROM items i
         LEFT JOIN counts c ON c.item_id = i.id AND c.count_type = 'initial'
         WHERE i.event_id = ${eid} AND i.team_id IS NOT NULL AND i.bin_number IS NOT NULL${whFragment}${brandFragment}
         GROUP BY i.team_id, i.bin_number
         ORDER BY i.team_id, i.bin_number`
  ) as { team_id: number; bin_number: string; total_items: number; counted_items: number }[];

  // Get team info
  const teamList = await db.select().from(teams).where(eq(teams.eventId, eid));
  // Group bins by team
  const teamBins = new Map<number, { binNumber: string; totalItems: number; countedItems: number; isComplete: boolean }[]>();
  for (const row of rows) {
    if (!teamBins.has(row.team_id)) teamBins.set(row.team_id, []);
    teamBins.get(row.team_id)!.push({
      binNumber: row.bin_number,
      totalItems: Number(row.total_items),
      countedItems: Number(row.counted_items),
      isComplete: Number(row.counted_items) >= Number(row.total_items),
    });
  }

  const teamsResult = teamList.map(t => {
    const bins = teamBins.get(t.id) || [];
    const totalBins = bins.length;
    const completedBins = bins.filter(b => b.isComplete).length;
    return {
      id: t.id,
      name: t.name,
      members: t.members,
      bins,
      totalBins,
      completedBins,
    };
  });

  return NextResponse.json({
    teams: teamsResult,
    filterOptions: { brands: brandRows.map(r => r.brand) },
  });
}
