import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { items, counts, teams, serialDiscrepancies } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { getApiUser } from "@/lib/api-auth";
import { exportToExcel } from "@/lib/excel";

// Correlated subquery: pick the latest count (highest id) per item for this event.
// This prevents duplicate rows when an item has both initial + verification counts.
function latestCountJoin(eventId: number) {
  return eq(
    counts.id,
    sql`(SELECT c.id FROM counts c WHERE c.item_id = ${items.id} AND c.event_id = ${eventId} ORDER BY c.id DESC LIMIT 1)`
  );
}

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

  let data: Record<string, unknown>[];

  if (type === "serials") {
    data = buildSerialExport(eventId);
  } else if (type === "variances") {
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
      .from(items)
      .innerJoin(counts, and(latestCountJoin(eventId), eq(counts.isMatch, false)))
      .leftJoin(teams, eq(items.teamId, teams.id))
      .where(eq(items.eventId, eventId))
      .orderBy(sql`abs(${counts.varianceValue}) DESC`)
      .all();
  } else {
    // Full export - all items with their latest count
    const itemRows = db
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
      .leftJoin(counts, latestCountJoin(eventId))
      .leftJoin(teams, eq(items.teamId, teams.id))
      .where(eq(items.eventId, eventId))
      .orderBy(items.binNumber, items.itemCode)
      .all();

    // Append unknown serials from discrepancies
    const discRows = db
      .select({
        itemCode: serialDiscrepancies.itemCode,
        description: serialDiscrepancies.description,
        binNumber: serialDiscrepancies.binNumber,
        unknownSerials: serialDiscrepancies.unknownSerials,
        teamName: teams.name,
      })
      .from(serialDiscrepancies)
      .innerJoin(teams, eq(serialDiscrepancies.teamId, teams.id))
      .where(eq(serialDiscrepancies.eventId, eventId))
      .all();

    const unknownRows: Record<string, unknown>[] = [];
    for (const disc of discRows) {
      const serials = JSON.parse(disc.unknownSerials) as string[];
      for (const serial of serials) {
        unknownRows.push({
          "Item Code": disc.itemCode,
          "Description": disc.description,
          "Brand": null,
          "Category": null,
          "Bin Number": disc.binNumber,
          "Warehouse": null,
          "Division": null,
          "Stock Status": "Unknown Serial",
          "Serial Number": serial,
          "On Hand": 0,
          "Avg Cost": null,
          "Total Value": null,
          "Counted Qty": 1,
          "Variance": 1,
          "Variance Value": null,
          "Is Match": false,
          "Team": disc.teamName,
          "Comment": "Unknown serial reported during count",
          "Counted At": null,
        });
      }
    }

    data = [...itemRows, ...unknownRows];
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
    const filenames: Record<string, string> = {
      variances: "stocktake_variances.csv",
      serials: "stocktake_serials.csv",
      full: "stocktake_full_export.csv",
    };
    const filename = filenames[type] || filenames.full;

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  }

  // Excel format
  const buffer = exportToExcel(data);

  const filenames: Record<string, string> = {
    variances: "stocktake_variances.xlsx",
    serials: "stocktake_serials.xlsx",
    full: "stocktake_full_export.xlsx",
  };
  const filename = filenames[type] || filenames.full;

  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

function buildSerialExport(eventId: number): Record<string, unknown>[] {
  // Get all expected serialized items with their latest count and team
  const expectedRows = db
    .select({
      itemCode: items.itemCode,
      description: items.description,
      binNumber: items.binNumber,
      serialNumber: items.serialNumber,
      onHand: items.onHand,
      countedQty: counts.countedQty,
      teamName: teams.name,
    })
    .from(items)
    .leftJoin(counts, latestCountJoin(eventId))
    .leftJoin(teams, eq(items.teamId, teams.id))
    .where(and(eq(items.eventId, eventId), eq(items.isSerialized, true)))
    .orderBy(items.itemCode, items.binNumber, items.serialNumber)
    .all();

  // Get all serial discrepancies for unknown serials
  const discrepancyRows = db
    .select({
      itemCode: serialDiscrepancies.itemCode,
      description: serialDiscrepancies.description,
      binNumber: serialDiscrepancies.binNumber,
      unknownSerials: serialDiscrepancies.unknownSerials,
      status: serialDiscrepancies.status,
      resolution: serialDiscrepancies.resolution,
      teamName: teams.name,
    })
    .from(serialDiscrepancies)
    .innerJoin(teams, eq(serialDiscrepancies.teamId, teams.id))
    .where(eq(serialDiscrepancies.eventId, eventId))
    .all();

  const rows: Record<string, unknown>[] = [];

  // Add expected serial rows — one per serialized item (one per serial number)
  for (const row of expectedRows) {
    let status: string;
    if (row.countedQty === null || row.countedQty === undefined) {
      status = "Uncounted";
    } else if (row.countedQty > 0) {
      status = "Found";
    } else {
      status = "Not Found";
    }

    rows.push({
      "Item Code": row.itemCode,
      "Description": row.description,
      "Bin Number": row.binNumber,
      "Serial Number": row.serialNumber,
      "Source": "Expected",
      "Status": status,
      "On Hand": row.onHand,
      "Counted Qty": row.countedQty,
      "Team": row.teamName,
      "Discrepancy Status": "—",
      "Resolution": "",
    });
  }

  // Add unknown serial rows from discrepancies
  for (const disc of discrepancyRows) {
    const unknowns = JSON.parse(disc.unknownSerials) as string[];
    const discStatus = disc.status === "resolved" ? "Resolved" : "Open";

    for (const serial of unknowns) {
      rows.push({
        "Item Code": disc.itemCode,
        "Description": disc.description,
        "Bin Number": disc.binNumber,
        "Serial Number": serial,
        "Source": "Unknown",
        "Status": "Reported",
        "On Hand": "",
        "Counted Qty": "",
        "Team": disc.teamName,
        "Discrepancy Status": discStatus,
        "Resolution": disc.resolution || "",
      });
    }
  }

  // Sort: Item Code, Bin, Source (Expected first), Serial Number
  rows.sort((a, b) => {
    const codeA = String(a["Item Code"] || "");
    const codeB = String(b["Item Code"] || "");
    if (codeA !== codeB) return codeA.localeCompare(codeB);

    const binA = String(a["Bin Number"] || "");
    const binB = String(b["Bin Number"] || "");
    if (binA !== binB) return binA.localeCompare(binB);

    const srcA = a["Source"] === "Expected" ? 0 : 1;
    const srcB = b["Source"] === "Expected" ? 0 : 1;
    if (srcA !== srcB) return srcA - srcB;

    const snA = String(a["Serial Number"] || "");
    const snB = String(b["Serial Number"] || "");
    return snA.localeCompare(snB);
  });

  return rows;
}
