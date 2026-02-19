import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  items, counts, teams, serialDiscrepancies, stocktakeEvents,
  verificationAssignments, queries, queryMessages, breakdowns,
  breakdownMessages, auditLog, supervisors,
} from "@/lib/db/schema";
import { eq, and, sql, inArray, asc, desc } from "drizzle-orm";
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
      "Check Status": counts.checkStatus,
      "Count Type": counts.countType,
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
        "Brand": ref?.brand ?? null,
        "Category": ref?.category ?? null,
        "Bin Number": disc.binNumber,
        "Bin Internal ID": disc.binInternalId,
        "Warehouse": ref?.warehouse ?? null,
        "Division": ref?.division ?? null,
        "Stock Status": ref?.stockStatus ?? null,
        "Serial Number": serial,
        "On Hand": 0,
        "Avg Cost": ref?.avgCost ?? null,
        "Counted Qty": 1,
        "Variance": 1,
        "Variance Value": ref?.avgCost ? 1 * ref.avgCost : null,
        "Check Status": "pending",
        "Count Type": "initial",
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
        "Brand": ref?.brand ?? null,
        "Category": ref?.category ?? null,
        "Bin Number": disc.binNumber,
        "Bin Internal ID": disc.binInternalId,
        "Warehouse": ref?.warehouse ?? null,
        "Division": ref?.division ?? null,
        "Stock Status": ref?.stockStatus ?? null,
        "Serial Number": serial,
        "On Hand": 0,
        "Avg Cost": ref?.avgCost ?? null,
        "Counted Qty": 1,
        "Variance": 1,
        "Variance Value": ref?.avgCost ? 1 * ref.avgCost : null,
        "Check Status": "accepted",
        "Count Type": "initial",
        "Team": disc.teamName,
        "Comment": "Approved unknown serial",
        "Counted At": null,
      });
    }
  }
  return rows;
}

// Look up source item metadata by itemCode
async function buildRefMap(eventId: number, itemCodes: string[]) {
  const unique = Array.from(new Set(itemCodes));
  const refMap: Record<string, {
    internalId: string | null;
    warehouse: string | null;
    division: string | null;
    stockStatus: string | null;
    brand: string | null;
    category: string | null;
    avgCost: number | null;
  }> = {};
  if (unique.length === 0) return refMap;

  const refItems = await db
    .select({
      itemCode: items.itemCode,
      internalId: items.internalId,
      warehouse: items.warehouse,
      division: items.division,
      stockStatus: items.stockStatus,
      brand: items.brand,
      category: items.category,
      avgCost: items.avgCost,
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

  // Admin/executive has eventId=0, find the latest event or use param
  if (!eventId || eventId === 0) {
    const paramEventId = request.nextUrl.searchParams.get("eventId");
    if (paramEventId) {
      eventId = Number(paramEventId);
    } else {
      const [latest] = await db
        .select()
        .from(stocktakeEvents)
        .orderBy(sql`id DESC`)
        .limit(1);
      if (latest) eventId = latest.id;
    }
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
  } else if (type === "queries") {
    data = await buildQueriesExport(eventId);
  } else if (type === "breakdowns") {
    data = await buildBreakdownsExport(eventId);
  } else if (type === "verifications") {
    data = await buildVerificationsExport(eventId);
  } else if (type === "audit_log") {
    data = await buildAuditLogExport(eventId);
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
        "Is Serialized": items.isSerialized,
        "On Hand": items.onHand,
        "Avg Cost": items.avgCost,
        "Total Value": items.totalValue,
        "Counted Qty": counts.countedQty,
        "Variance": counts.variance,
        "Variance Value": counts.varianceValue,
        "Is Match": counts.isMatch,
        "Check Status": counts.checkStatus,
        "Count Type": counts.countType,
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
          "Brand": ref?.brand ?? null,
          "Category": ref?.category ?? null,
          "Bin Number": disc.binNumber,
          "Bin Internal ID": disc.binInternalId,
          "Warehouse": ref?.warehouse ?? null,
          "Division": ref?.division ?? null,
          "Stock Status": ref?.stockStatus ?? null,
          "Serial Number": serial,
          "Is Serialized": true,
          "On Hand": 0,
          "Avg Cost": ref?.avgCost ?? null,
          "Total Value": null,
          "Counted Qty": 1,
          "Variance": 1,
          "Variance Value": ref?.avgCost ? 1 * ref.avgCost : null,
          "Is Match": false,
          "Check Status": "pending",
          "Count Type": "initial",
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
          "Brand": ref?.brand ?? null,
          "Category": ref?.category ?? null,
          "Bin Number": disc.binNumber,
          "Bin Internal ID": disc.binInternalId,
          "Warehouse": ref?.warehouse ?? null,
          "Division": ref?.division ?? null,
          "Stock Status": ref?.stockStatus ?? null,
          "Serial Number": serial,
          "Is Serialized": true,
          "On Hand": 0,
          "Avg Cost": ref?.avgCost ?? null,
          "Total Value": null,
          "Counted Qty": 1,
          "Variance": 1,
          "Variance Value": ref?.avgCost ? 1 * ref.avgCost : null,
          "Is Match": false,
          "Check Status": "accepted",
          "Count Type": "initial",
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
    queries: "stocktake_queries",
    breakdowns: "stocktake_breakdowns",
    verifications: "stocktake_verifications",
    audit_log: "stocktake_audit_log",
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
      brand: items.brand,
      category: items.category,
      binNumber: items.binNumber,
      binInternalId: items.binInternalId,
      internalId: items.internalId,
      warehouse: items.warehouse,
      division: items.division,
      stockStatus: items.stockStatus,
      serialNumber: items.serialNumber,
      onHand: items.onHand,
      avgCost: items.avgCost,
      countedQty: counts.countedQty,
      checkStatus: counts.checkStatus,
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
      verificationStatus: serialDiscrepancies.verificationStatus,
      verificationTeamId: serialDiscrepancies.verificationTeamId,
      verifiedSerials: serialDiscrepancies.verifiedSerials,
    })
    .from(serialDiscrepancies)
    .innerJoin(teams, eq(serialDiscrepancies.teamId, teams.id))
    .where(eq(serialDiscrepancies.eventId, eventId));

  // Resolve verification team names
  const verTeamIds = Array.from(new Set(discrepancyRows.filter((d) => d.verificationTeamId).map((d) => d.verificationTeamId!)));
  const verTeamNameMap: Record<number, string> = {};
  if (verTeamIds.length > 0) {
    const verTeams = await db.select({ id: teams.id, name: teams.name }).from(teams).where(inArray(teams.id, verTeamIds));
    for (const vt of verTeams) verTeamNameMap[vt.id] = vt.name;
  }

  // Ref map for unknown serial metadata
  const refMap = await buildRefMap(eventId, discrepancyRows.map((d) => d.itemCode));

  const rows: Record<string, unknown>[] = [];

  // Add expected serial rows
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
      "Item Internal ID": row.internalId,
      "Brand": row.brand,
      "Category": row.category,
      "Bin Number": row.binNumber,
      "Bin Internal ID": row.binInternalId,
      "Warehouse": row.warehouse,
      "Division": row.division,
      "Stock Status": row.stockStatus,
      "Serial Number": row.serialNumber,
      "Source": "Expected",
      "Status": status,
      "Check Status": row.checkStatus ?? "",
      "On Hand": row.onHand,
      "Avg Cost": row.avgCost,
      "Counted Qty": row.countedQty,
      "Team": row.teamName,
      "Discrepancy Status": "\u2014",
      "Verification Team": "",
      "Verification Status": "",
      "Verification Result": "",
      "Resolution": "",
    });
  }

  // Add unknown + approved serial rows from discrepancies
  for (const disc of discrepancyRows) {
    if (disc.status === "resolved" && disc.resolutionType === "dismissed") {
      const approved: string[] = disc.approvedSerials ? JSON.parse(disc.approvedSerials) : [];
      if (approved.length === 0) continue;
    }

    const ref = refMap[disc.itemCode];
    const unknowns = JSON.parse(disc.unknownSerials) as string[];
    const discStatus = disc.status === "resolved" ? "Resolved" : "Open";
    const verTeamName = disc.verificationTeamId ? (verTeamNameMap[disc.verificationTeamId] ?? "") : "";
    const parsedVerified = disc.verifiedSerials ? safeJsonParse<{ serial: string; status: string }[]>(disc.verifiedSerials, []) : [];

    for (const serial of unknowns) {
      const verResult = parsedVerified.find((v) => v.serial === serial);
      rows.push({
        "Item Code": disc.itemCode,
        "Description": disc.description,
        "Item Internal ID": ref?.internalId ?? "",
        "Brand": ref?.brand ?? "",
        "Category": ref?.category ?? "",
        "Bin Number": disc.binNumber,
        "Bin Internal ID": disc.binInternalId,
        "Warehouse": ref?.warehouse ?? "",
        "Division": ref?.division ?? "",
        "Stock Status": ref?.stockStatus ?? "",
        "Serial Number": serial,
        "Source": "Unknown",
        "Status": "Reported",
        "Check Status": "pending",
        "On Hand": "",
        "Avg Cost": ref?.avgCost ?? "",
        "Counted Qty": "",
        "Team": disc.teamName,
        "Discrepancy Status": discStatus,
        "Verification Team": verTeamName,
        "Verification Status": disc.verificationStatus ?? "",
        "Verification Result": verResult?.status ?? "",
        "Resolution": disc.resolution || "",
      });
    }

    const approved: string[] = disc.approvedSerials ? JSON.parse(disc.approvedSerials) : [];
    for (const serial of approved) {
      rows.push({
        "Item Code": disc.itemCode,
        "Description": disc.description,
        "Item Internal ID": ref?.internalId ?? "",
        "Brand": ref?.brand ?? "",
        "Category": ref?.category ?? "",
        "Bin Number": disc.binNumber,
        "Bin Internal ID": disc.binInternalId,
        "Warehouse": ref?.warehouse ?? "",
        "Division": ref?.division ?? "",
        "Stock Status": ref?.stockStatus ?? "",
        "Serial Number": serial,
        "Source": "Unknown",
        "Status": "Approved",
        "Check Status": "accepted",
        "On Hand": "",
        "Avg Cost": ref?.avgCost ?? "",
        "Counted Qty": 1,
        "Team": disc.teamName,
        "Discrepancy Status": "Resolved",
        "Verification Team": verTeamName,
        "Verification Status": disc.verificationStatus ?? "",
        "Verification Result": "",
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

// ─── Queries Export ────────────────────────────────────────────────────────
async function buildQueriesExport(eventId: number): Promise<Record<string, unknown>[]> {
  const allQueries = await db
    .select({
      id: queries.id,
      queryType: queries.queryType,
      itemCode: queries.itemCode,
      message: queries.message,
      status: queries.status,
      createdAt: queries.createdAt,
      resolvedAt: queries.resolvedAt,
      teamName: teams.name,
    })
    .from(queries)
    .innerJoin(teams, eq(queries.teamId, teams.id))
    .where(eq(queries.eventId, eventId))
    .orderBy(asc(queries.id));

  // Fetch all messages for these queries
  const queryIds = allQueries.map((q) => q.id);
  const allMessages = queryIds.length > 0
    ? await db
        .select()
        .from(queryMessages)
        .where(inArray(queryMessages.queryId, queryIds))
        .orderBy(asc(queryMessages.createdAt))
    : [];

  // Group messages by query
  const msgMap = new Map<number, typeof allMessages>();
  for (const m of allMessages) {
    if (!msgMap.has(m.queryId)) msgMap.set(m.queryId, []);
    msgMap.get(m.queryId)!.push(m);
  }

  const rows: Record<string, unknown>[] = [];
  for (const q of allQueries) {
    const msgs = msgMap.get(q.id) || [];
    const conversation = msgs.map((m) =>
      `[${m.senderType}] ${m.message}`
    ).join(" | ");

    rows.push({
      "Query ID": q.id,
      "Type": q.queryType,
      "Item Code": q.itemCode,
      "Team": q.teamName,
      "Status": q.status,
      "Initial Message": q.message,
      "Full Conversation": conversation,
      "Message Count": msgs.length,
      "Created At": q.createdAt,
      "Resolved At": q.resolvedAt,
    });
  }

  return rows;
}

// ─── Breakdowns Export ─────────────────────────────────────────────────────
async function buildBreakdownsExport(eventId: number): Promise<Record<string, unknown>[]> {
  const allBreakdowns = await db
    .select({
      id: breakdowns.id,
      itemCode: breakdowns.itemCode,
      clientName: breakdowns.clientName,
      quantity: breakdowns.quantity,
      poNumber: breakdowns.poNumber,
      reason: breakdowns.reason,
      approvalStatus: breakdowns.approvalStatus,
      createdAt: breakdowns.createdAt,
      resolvedAt: breakdowns.resolvedAt,
      teamName: teams.name,
      approvedById: breakdowns.approvedBy,
    })
    .from(breakdowns)
    .innerJoin(teams, eq(breakdowns.teamId, teams.id))
    .where(eq(breakdowns.eventId, eventId))
    .orderBy(asc(breakdowns.id));

  // Resolve approver names
  const approverIds = Array.from(new Set(allBreakdowns.filter((b) => b.approvedById).map((b) => b.approvedById!)));
  const approverMap: Record<number, string> = {};
  if (approverIds.length > 0) {
    const approvers = await db.select({ id: supervisors.id, name: supervisors.name }).from(supervisors).where(inArray(supervisors.id, approverIds));
    for (const a of approvers) approverMap[a.id] = a.name;
  }

  // Fetch all messages
  const bdIds = allBreakdowns.map((b) => b.id);
  const allMessages = bdIds.length > 0
    ? await db
        .select()
        .from(breakdownMessages)
        .where(inArray(breakdownMessages.breakdownId, bdIds))
        .orderBy(asc(breakdownMessages.createdAt))
    : [];

  const msgMap = new Map<number, typeof allMessages>();
  for (const m of allMessages) {
    if (!msgMap.has(m.breakdownId)) msgMap.set(m.breakdownId, []);
    msgMap.get(m.breakdownId)!.push(m);
  }

  const rows: Record<string, unknown>[] = [];
  for (const b of allBreakdowns) {
    const msgs = msgMap.get(b.id) || [];
    const conversation = msgs.map((m) =>
      `[${m.senderType}] ${m.message}`
    ).join(" | ");

    rows.push({
      "Breakdown ID": b.id,
      "Item Code": b.itemCode,
      "Client Name": b.clientName,
      "Quantity": b.quantity,
      "PO Number": b.poNumber,
      "Reason": b.reason,
      "Approval Status": b.approvalStatus,
      "Team": b.teamName,
      "Approved By": b.approvedById ? (approverMap[b.approvedById] ?? `Supervisor #${b.approvedById}`) : "",
      "Full Conversation": conversation,
      "Message Count": msgs.length,
      "Created At": b.createdAt,
      "Resolved At": b.resolvedAt,
    });
  }

  return rows;
}

// ─── Verification Assignments Export ───────────────────────────────────────
async function buildVerificationsExport(eventId: number): Promise<Record<string, unknown>[]> {
  const allVerifications = await db
    .select({
      id: verificationAssignments.id,
      countId: verificationAssignments.countId,
      itemId: verificationAssignments.itemId,
      status: verificationAssignments.status,
      assignedTeamId: verificationAssignments.assignedTeamId,
      assignedBy: verificationAssignments.assignedBy,
      assignedAt: verificationAssignments.assignedAt,
      completedAt: verificationAssignments.completedAt,
    })
    .from(verificationAssignments)
    .where(eq(verificationAssignments.eventId, eventId))
    .orderBy(asc(verificationAssignments.id));

  if (allVerifications.length === 0) return [];

  // Resolve team names
  const teamIds = Array.from(new Set(allVerifications.map((v) => v.assignedTeamId)));
  const teamNameMap: Record<number, string> = {};
  if (teamIds.length > 0) {
    const teamRows = await db.select({ id: teams.id, name: teams.name }).from(teams).where(inArray(teams.id, teamIds));
    for (const t of teamRows) teamNameMap[t.id] = t.name;
  }

  // Resolve supervisor names
  const supIds = Array.from(new Set(allVerifications.map((v) => v.assignedBy)));
  const supNameMap: Record<number, string> = {};
  if (supIds.length > 0) {
    const supRows = await db.select({ id: supervisors.id, name: supervisors.name }).from(supervisors).where(inArray(supervisors.id, supIds));
    for (const s of supRows) supNameMap[s.id] = s.name;
  }

  // Get original count + item data
  const countIds = allVerifications.map((v) => v.countId);
  const origCounts = await db
    .select({
      id: counts.id,
      countedQty: counts.countedQty,
      variance: counts.variance,
      teamId: counts.teamId,
      itemCode: items.itemCode,
      description: items.description,
      binNumber: items.binNumber,
      serialNumber: items.serialNumber,
      onHand: items.onHand,
    })
    .from(counts)
    .innerJoin(items, eq(counts.itemId, items.id))
    .where(inArray(counts.id, countIds));

  const origMap: Record<number, typeof origCounts[0]> = {};
  for (const c of origCounts) origMap[c.id] = c;

  // Get original counting team names
  const origTeamIds = Array.from(new Set(origCounts.map((c) => c.teamId)));
  const origTeamMap: Record<number, string> = {};
  if (origTeamIds.length > 0) {
    const origTeamRows = await db.select({ id: teams.id, name: teams.name }).from(teams).where(inArray(teams.id, origTeamIds));
    for (const t of origTeamRows) origTeamMap[t.id] = t.name;
  }

  // Get verification counts
  const verificationIds = allVerifications.map((v) => v.id);
  const verCounts = await db
    .select({
      verificationId: counts.verificationId,
      countedQty: counts.countedQty,
      variance: counts.variance,
      countedAt: counts.countedAt,
    })
    .from(counts)
    .where(and(eq(counts.eventId, eventId), eq(counts.countType, "verification"), inArray(counts.verificationId, verificationIds)));

  const verCountMap: Record<number, typeof verCounts[0]> = {};
  for (const vc of verCounts) {
    if (vc.verificationId != null) verCountMap[vc.verificationId] = vc;
  }

  const rows: Record<string, unknown>[] = [];
  for (const v of allVerifications) {
    const orig = origMap[v.countId];
    const verCount = verCountMap[v.id];

    rows.push({
      "Verification ID": v.id,
      "Item Code": orig?.itemCode ?? "",
      "Description": orig?.description ?? "",
      "Bin Number": orig?.binNumber ?? "",
      "Serial Number": orig?.serialNumber ?? "",
      "On Hand": orig?.onHand ?? "",
      "Original Team": orig ? (origTeamMap[orig.teamId] ?? "") : "",
      "Original Qty": orig?.countedQty ?? "",
      "Original Variance": orig?.variance ?? "",
      "Verification Team": teamNameMap[v.assignedTeamId] ?? "",
      "Verification Qty": verCount?.countedQty ?? "",
      "Verification Variance": verCount?.variance ?? "",
      "Verification Counted At": verCount?.countedAt ?? "",
      "Status": v.status,
      "Assigned By": supNameMap[v.assignedBy] ?? `Supervisor #${v.assignedBy}`,
      "Assigned At": v.assignedAt,
      "Completed At": v.completedAt ?? "",
    });
  }

  return rows;
}

// ─── Audit Log Export ──────────────────────────────────────────────────────
async function buildAuditLogExport(eventId: number): Promise<Record<string, unknown>[]> {
  const logEntries = await db
    .select()
    .from(auditLog)
    .where(eq(auditLog.eventId, eventId))
    .orderBy(desc(auditLog.id));

  return logEntries.map((entry) => ({
    "Log ID": entry.id,
    "Action": entry.action,
    "User ID": entry.userId,
    "User Type": entry.userType,
    "Table": entry.tableName,
    "Record ID": entry.recordId,
    "Old Value": entry.oldValue,
    "New Value": entry.newValue,
    "Created At": entry.createdAt,
  }));
}

function safeJsonParse<T>(json: string, fallback: T): T {
  try { return JSON.parse(json) as T; } catch { return fallback; }
}
