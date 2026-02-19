import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { items, counts, teams, serialDiscrepancies, stocktakeEvents } from "@/lib/db/schema";
import { eq, and, sql, inArray } from "drizzle-orm";
import { getApiUser, getEventWarehouses, warehouseFilter } from "@/lib/api-auth";
import { exportToExcel } from "@/lib/excel";

// Correlated subquery: pick the latest count (highest id) per item for this event.
// This prevents duplicate rows when an item has both initial + verification counts.
function latestCountJoin(eventId: number) {
  return eq(
    counts.id,
    sql`(SELECT c.id FROM counts c WHERE c.item_id = ${items.id} AND c.event_id = ${eventId} ORDER BY c.id DESC LIMIT 1)`
  );
}

// Build variance rows from items/counts table
// serialized: true = serialized only, false = non-serialized only, null = both
// direction: "up" = variance > 0, "down" = variance < 0, "both" = all variances
async function buildItemVariances(
  eventId: number,
  serialized: boolean | null,
  direction: "up" | "down" | "both",
  warehouses: string[] | null,
): Promise<Record<string, unknown>[]> {
  return db
    .select({
      "Item Internal ID": items.internalId,
      "Item Code": items.itemCode,
      "Description": items.description,
      "Brand": items.brand,
      "Category": items.category,
      "Bin Number": items.binNumber,
      "Bin Internal ID": items.binInternalId,
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
    .where(and(
      eq(items.eventId, eventId),
      warehouseFilter(warehouses),
      serialized !== null ? eq(items.isSerialized, serialized) : undefined,
      direction === "up"
        ? sql`${counts.variance} > 0`
        : direction === "down"
          ? sql`${counts.variance} < 0`
          : undefined,
    ))
    .orderBy(sql`abs(${counts.varianceValue}) DESC`);
}

// Build unknown/approved serial rows from discrepancies (serialized variances UP)
async function buildDiscrepancyVariances(eventId: number, warehouses: string[] | null): Promise<Record<string, unknown>[]> {
  const discRows = await db
    .select({
      itemCode: serialDiscrepancies.itemCode,
      description: serialDiscrepancies.description,
      binNumber: serialDiscrepancies.binNumber,
      binInternalId: serialDiscrepancies.binInternalId,
      unknownSerials: serialDiscrepancies.unknownSerials,
      approvedSerials: serialDiscrepancies.approvedSerials,
      status: serialDiscrepancies.status,
      resolutionType: serialDiscrepancies.resolutionType,
      teamName: teams.name,
    })
    .from(serialDiscrepancies)
    .innerJoin(teams, eq(serialDiscrepancies.teamId, teams.id))
    .where(eq(serialDiscrepancies.eventId, eventId));

  // Look up source item metadata for each unique itemCode
  const refMap = await buildRefMap(eventId, discRows.map((d) => d.itemCode));

  const rows: Record<string, unknown>[] = [];
  for (const disc of discRows) {
    // Skip fully dismissed discrepancies (resolved + dismissed + no approved serials)
    if (disc.status === "resolved" && disc.resolutionType === "dismissed") {
      const approved: string[] = disc.approvedSerials ? JSON.parse(disc.approvedSerials) : [];
      if (approved.length === 0) continue;
    }

    const ref = refMap[disc.itemCode];

    // Skip if source item's warehouse is not in the event's selected warehouses
    if (warehouses && warehouses.length > 0 && ref?.warehouse && !warehouses.includes(ref.warehouse)) continue;

    // Open unknowns
    const unknowns = JSON.parse(disc.unknownSerials) as string[];
    for (const serial of unknowns) {
      rows.push({
        "Item Internal ID": ref?.internalId ?? null,
        "Item Code": disc.itemCode,
        "Description": disc.description,
        "Brand": null,
        "Category": null,
        "Bin Number": disc.binNumber,
        "Bin Internal ID": disc.binInternalId,
        "Warehouse": ref?.warehouse ?? null,
        "Division": ref?.division ?? null,
        "Stock Status": ref?.stockStatus ?? null,
        "Serial Number": serial,
        "On Hand": 0,
        "Avg Cost": null,
        "Counted Qty": 1,
        "Variance": 1,
        "Variance Value": null,
        "Team": disc.teamName,
        "Comment": "Unknown serial reported during count",
        "Counted At": null,
      });
    }

    // Approved serials
    const approved: string[] = disc.approvedSerials ? JSON.parse(disc.approvedSerials) : [];
    for (const serial of approved) {
      rows.push({
        "Item Internal ID": ref?.internalId ?? null,
        "Item Code": disc.itemCode,
        "Description": disc.description,
        "Brand": null,
        "Category": null,
        "Bin Number": disc.binNumber,
        "Bin Internal ID": disc.binInternalId,
        "Warehouse": ref?.warehouse ?? null,
        "Division": ref?.division ?? null,
        "Stock Status": ref?.stockStatus ?? null,
        "Serial Number": serial,
        "On Hand": 0,
        "Avg Cost": null,
        "Counted Qty": 1,
        "Variance": 1,
        "Variance Value": null,
        "Team": disc.teamName,
        "Comment": "Approved unknown serial",
        "Counted At": null,
      });
    }
  }
  return rows;
}

// Look up source item metadata (internalId, warehouse, division, stockStatus) by itemCode
async function buildRefMap(eventId: number, itemCodes: string[]) {
  const unique = Array.from(new Set(itemCodes));
  const refMap: Record<string, { internalId: string | null; warehouse: string | null; division: string | null; stockStatus: string | null }> = {};
  if (unique.length === 0) return refMap;

  const refItems = await db
    .select({
      itemCode: items.itemCode,
      internalId: items.internalId,
      warehouse: items.warehouse,
      division: items.division,
      stockStatus: items.stockStatus,
    })
    .from(items)
    .where(and(eq(items.eventId, eventId), inArray(items.itemCode, unique)));

  for (const ref of refItems) {
    if (!refMap[ref.itemCode]) {
      refMap[ref.itemCode] = ref;
    }
  }
  return refMap;
}

export async function GET(request: NextRequest) {
  const user = getApiUser(request);
  if (!user || (user.type !== "supervisor" && user.type !== "admin" && user.type !== "auditor" && user.type !== "executive")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const format = request.nextUrl.searchParams.get("format") || "xlsx";
  const type = request.nextUrl.searchParams.get("type") || "full";

  let eventId = user.eventId;

  // Admin has eventId=0, find the latest event
  if (!eventId || eventId === 0) {
    const [latest] = await db
      .select()
      .from(stocktakeEvents)
      .orderBy(sql`id DESC`)
      .limit(1);
    if (latest) eventId = latest.id;
  }

  const warehouses = await getEventWarehouses(eventId);
  let data: Record<string, unknown>[];

  if (type === "serials") {
    data = await buildSerialExport(eventId, warehouses);
  } else if (type === "variances_nonserialized_up") {
    data = await buildItemVariances(eventId, false, "up", warehouses);
  } else if (type === "variances_nonserialized_down") {
    data = await buildItemVariances(eventId, false, "down", warehouses);
  } else if (type === "variances_serialized_up") {
    data = await buildDiscrepancyVariances(eventId, warehouses);
  } else if (type === "variances_serialized_down") {
    data = await buildItemVariances(eventId, true, "down", warehouses);
  } else if (type === "variances_all" || type === "variances") {
    // All variances: non-serialized (both directions) + serialized down + unknown serials up
    const [itemVariances, discrepancyVariances] = await Promise.all([
      buildItemVariances(eventId, null, "both", warehouses),
      buildDiscrepancyVariances(eventId, warehouses),
    ]);
    data = [...itemVariances, ...discrepancyVariances];
  } else {
    // Full / master export - all items with their latest count
    const itemRows = await db
      .select({
        "Item Internal ID": items.internalId,
        "Item Code": items.itemCode,
        "Description": items.description,
        "Brand": items.brand,
        "Category": items.category,
        "Bin Number": items.binNumber,
        "Bin Internal ID": items.binInternalId,
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
      .where(and(eq(items.eventId, eventId), warehouseFilter(warehouses)))
      .orderBy(items.binNumber, items.itemCode);

    // Append unknown + approved serials from discrepancies (exclude fully dismissed)
    const discRows = await db
      .select({
        itemCode: serialDiscrepancies.itemCode,
        description: serialDiscrepancies.description,
        binNumber: serialDiscrepancies.binNumber,
        binInternalId: serialDiscrepancies.binInternalId,
        unknownSerials: serialDiscrepancies.unknownSerials,
        approvedSerials: serialDiscrepancies.approvedSerials,
        status: serialDiscrepancies.status,
        resolutionType: serialDiscrepancies.resolutionType,
        teamName: teams.name,
      })
      .from(serialDiscrepancies)
      .innerJoin(teams, eq(serialDiscrepancies.teamId, teams.id))
      .where(eq(serialDiscrepancies.eventId, eventId));

    // Look up source item metadata for unknown serial rows
    const fullRefMap = await buildRefMap(eventId, discRows.map((d) => d.itemCode));

    const unknownRows: Record<string, unknown>[] = [];
    for (const disc of discRows) {
      // Skip fully dismissed discrepancies (resolved + dismissed + no approved serials)
      if (disc.status === "resolved" && disc.resolutionType === "dismissed") {
        const approved: string[] = disc.approvedSerials ? JSON.parse(disc.approvedSerials) : [];
        if (approved.length === 0) continue;
      }

      const ref = fullRefMap[disc.itemCode];

      // Skip if source item's warehouse is not in selected warehouses
      if (warehouses && warehouses.length > 0 && ref?.warehouse && !warehouses.includes(ref.warehouse)) continue;

      // Open unknowns — included as "Unknown Serial"
      const unknowns = JSON.parse(disc.unknownSerials) as string[];
      for (const serial of unknowns) {
        unknownRows.push({
          "Item Internal ID": ref?.internalId ?? null,
          "Item Code": disc.itemCode,
          "Description": disc.description,
          "Brand": null,
          "Category": null,
          "Bin Number": disc.binNumber,
          "Bin Internal ID": disc.binInternalId,
          "Warehouse": ref?.warehouse ?? null,
          "Division": ref?.division ?? null,
          "Stock Status": ref?.stockStatus ?? null,
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

      // Approved serials — included as "Approved Unknown Serial"
      const approved: string[] = disc.approvedSerials ? JSON.parse(disc.approvedSerials) : [];
      for (const serial of approved) {
        unknownRows.push({
          "Item Internal ID": ref?.internalId ?? null,
          "Item Code": disc.itemCode,
          "Description": disc.description,
          "Brand": null,
          "Category": null,
          "Bin Number": disc.binNumber,
          "Bin Internal ID": disc.binInternalId,
          "Warehouse": ref?.warehouse ?? null,
          "Division": ref?.division ?? null,
          "Stock Status": ref?.stockStatus ?? null,
          "Serial Number": serial,
          "On Hand": 0,
          "Avg Cost": null,
          "Total Value": null,
          "Counted Qty": 1,
          "Variance": 1,
          "Variance Value": null,
          "Is Match": false,
          "Team": disc.teamName,
          "Comment": "Approved unknown serial",
          "Counted At": null,
        });
      }
    }

    data = [...itemRows, ...unknownRows];
  }

  // Filename mapping
  const filenameBase: Record<string, string> = {
    full: "stocktake_master_export",
    variances_nonserialized_up: "stocktake_nonserialized_variances_up",
    variances_nonserialized_down: "stocktake_nonserialized_variances_down",
    variances_serialized_up: "stocktake_serialized_variances_up",
    variances_serialized_down: "stocktake_serialized_variances_down",
    variances_all: "stocktake_all_variances",
    variances: "stocktake_all_variances",
    serials: "stocktake_serials",
  };
  const base = filenameBase[type] || filenameBase.full;

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
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="${base}.csv"`,
      },
    });
  }

  // Excel format
  const buffer = exportToExcel(data);

  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${base}.xlsx"`,
    },
  });
}

async function buildSerialExport(eventId: number, warehouses: string[] | null): Promise<Record<string, unknown>[]> {
  // Get all expected serialized items with their latest count and team
  const expectedRows = await db
    .select({
      itemCode: items.itemCode,
      description: items.description,
      binNumber: items.binNumber,
      binInternalId: items.binInternalId,
      serialNumber: items.serialNumber,
      onHand: items.onHand,
      countedQty: counts.countedQty,
      teamName: teams.name,
    })
    .from(items)
    .leftJoin(counts, latestCountJoin(eventId))
    .leftJoin(teams, eq(items.teamId, teams.id))
    .where(and(eq(items.eventId, eventId), eq(items.isSerialized, true), warehouseFilter(warehouses)))
    .orderBy(items.itemCode, items.binNumber, items.serialNumber);

  // Get all serial discrepancies for unknown serials
  const discrepancyRows = await db
    .select({
      itemCode: serialDiscrepancies.itemCode,
      description: serialDiscrepancies.description,
      binNumber: serialDiscrepancies.binNumber,
      binInternalId: serialDiscrepancies.binInternalId,
      unknownSerials: serialDiscrepancies.unknownSerials,
      approvedSerials: serialDiscrepancies.approvedSerials,
      status: serialDiscrepancies.status,
      resolutionType: serialDiscrepancies.resolutionType,
      resolution: serialDiscrepancies.resolution,
      teamName: teams.name,
    })
    .from(serialDiscrepancies)
    .innerJoin(teams, eq(serialDiscrepancies.teamId, teams.id))
    .where(eq(serialDiscrepancies.eventId, eventId));

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
      "Bin Internal ID": row.binInternalId,
      "Serial Number": row.serialNumber,
      "Source": "Expected",
      "Status": status,
      "On Hand": row.onHand,
      "Counted Qty": row.countedQty,
      "Team": row.teamName,
      "Discrepancy Status": "\u2014",
      "Resolution": "",
    });
  }

  // Add unknown + approved serial rows from discrepancies (exclude dismissed)
  for (const disc of discrepancyRows) {
    // Skip fully dismissed discrepancies
    if (disc.status === "resolved" && disc.resolutionType === "dismissed") {
      const approved: string[] = disc.approvedSerials ? JSON.parse(disc.approvedSerials) : [];
      if (approved.length === 0) continue;
    }

    // Open unknowns
    const unknowns = JSON.parse(disc.unknownSerials) as string[];
    const discStatus = disc.status === "resolved" ? "Resolved" : "Open";

    for (const serial of unknowns) {
      rows.push({
        "Item Code": disc.itemCode,
        "Description": disc.description,
        "Bin Number": disc.binNumber,
        "Bin Internal ID": disc.binInternalId,
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

    // Approved serials
    const approved: string[] = disc.approvedSerials ? JSON.parse(disc.approvedSerials) : [];
    for (const serial of approved) {
      rows.push({
        "Item Code": disc.itemCode,
        "Description": disc.description,
        "Bin Number": disc.binNumber,
        "Bin Internal ID": disc.binInternalId,
        "Serial Number": serial,
        "Source": "Unknown",
        "Status": "Approved",
        "On Hand": "",
        "Counted Qty": 1,
        "Team": disc.teamName,
        "Discrepancy Status": "Resolved",
        "Resolution": "Approved by supervisor",
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
