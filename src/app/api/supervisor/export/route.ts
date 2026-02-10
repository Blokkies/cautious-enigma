import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { items, counts, teams } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { getApiUser } from "@/lib/api-auth";
import { exportToExcel } from "@/lib/excel";

export async function GET(request: NextRequest) {
  const user = getApiUser(request);
  if (!user || (user.type !== "supervisor" && user.type !== "admin")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const format = request.nextUrl.searchParams.get("format") || "xlsx";
  const type = request.nextUrl.searchParams.get("type") || "full";

  let eventId = user.eventId;

  // Admin has eventId=0, find the latest event
  if (!eventId || eventId === 0) {
    const { stocktakeEvents } = await import("@/lib/db/schema");
    const latest = db
      .select()
      .from(stocktakeEvents)
      .orderBy(sql`id DESC`)
      .limit(1)
      .get();
    if (latest) eventId = latest.id;
  }

  let data;

  if (type === "variances") {
    data = db
      .select({
        "Item Code": items.itemCode,
        "Description": items.description,
        "Brand": items.brand,
        "Category": items.category,
        "Bin Number": items.binNumber,
        "Warehouse": items.warehouse,
        "Division": items.division,
        "Stock Status": items.stockStatus,
        "Serial Number": items.serialNumber,
        "On Hand": items.onHand,
        "Avg Cost": items.avgCost,
        "Counted Qty": counts.countedQty,
        "Variance": counts.variance,
        "Variance Value": counts.varianceValue,
        "Team": teams.name,
        "Comment": counts.comment,
        "Counted At": counts.countedAt,
      })
      .from(counts)
      .innerJoin(items, eq(counts.itemId, items.id))
      .innerJoin(teams, eq(counts.teamId, teams.id))
      .where(
        and(eq(counts.eventId, eventId), eq(counts.isMatch, false))
      )
      .orderBy(sql`abs(variance_value) DESC`)
      .all();
  } else {
    // Full export - all items with count results
    data = db
      .select({
        "Item Code": items.itemCode,
        "Description": items.description,
        "Brand": items.brand,
        "Category": items.category,
        "Bin Number": items.binNumber,
        "Warehouse": items.warehouse,
        "Division": items.division,
        "Stock Status": items.stockStatus,
        "Serial Number": items.serialNumber,
        "On Hand": items.onHand,
        "Avg Cost": items.avgCost,
        "Total Value": items.totalValue,
        "Counted Qty": counts.countedQty,
        "Variance": counts.variance,
        "Variance Value": counts.varianceValue,
        "Is Match": counts.isMatch,
        "Team": teams.name,
        "Comment": counts.comment,
        "Counted At": counts.countedAt,
      })
      .from(items)
      .leftJoin(
        counts,
        and(eq(counts.itemId, items.id), eq(counts.eventId, eventId))
      )
      .leftJoin(teams, eq(items.teamId, teams.id))
      .where(eq(items.eventId, eventId))
      .orderBy(items.binNumber, items.itemCode)
      .all();
  }

  if (format === "csv") {
    if (data.length === 0) {
      return new NextResponse("No data", { status: 404 });
    }

    const headers = Object.keys(data[0]);
    const csvRows = [
      headers.join(","),
      ...data.map((row) =>
        headers
          .map((h) => {
            const val = (row as Record<string, unknown>)[h];
            if (val === null || val === undefined) return "";
            const str = String(val);
            if (str.includes(",") || str.includes('"') || str.includes("\n")) {
              return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
          })
          .join(",")
      ),
    ];

    const csv = csvRows.join("\n");
    const filename = type === "variances"
      ? "stocktake_variances.csv"
      : "stocktake_full_export.csv";

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  }

  // Excel format
  const buffer = exportToExcel(
    data as Record<string, unknown>[]
  );

  const filename = type === "variances"
    ? "stocktake_variances.xlsx"
    : "stocktake_full_export.xlsx";

  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
