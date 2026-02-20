import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  items, counts, teams, serialDiscrepancies, stocktakeEvents,
  verificationAssignments, queries, queryMessages, breakdowns,
  breakdownMessages, auditLog, supervisors, admins, executives,
} from "@/lib/db/schema";
import { eq, and, sql, inArray, asc, desc } from "drizzle-orm";
import { getApiUser, getEventWarehouses, warehouseFilter } from "@/lib/api-auth";
import { exportToExcel } from "@/lib/excel";

// Correlated subquery: pick the latest count (highest id) per item for this event.
// This prevents duplicate rows when an item has both initial + verification counts.
function latestCountJoin(eventId: number) {
  return eq(
    counts.id,
    sql`(SELECT c.id FROM counts c WHERE c.item_id = ${items.id} AND c.event_id = ${eventId} ORDER BY c.counted_at DESC, c.id DESC LIMIT 1)`
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

  // Build filename prefix with warehouse name
  const [eventRow] = await db.select({ name: stocktakeEvents.name }).from(stocktakeEvents).where(eq(stocktakeEvents.id, eventId));
  const warehouseTag = warehouses && warehouses.length > 0
    ? warehouses.join("_").replace(/[^a-zA-Z0-9_-]/g, "_")
    : null;
  const eventTag = eventRow?.name?.replace(/[^a-zA-Z0-9_-]/g, "_") ?? "stocktake";
  const filePrefix = warehouseTag ? `${eventTag}_${warehouseTag}` : eventTag;

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
    full: `${filePrefix}_master_export`,
    variances_nonserialized_up: `${filePrefix}_nonserialized_variances_up`,
    variances_nonserialized_down: `${filePrefix}_nonserialized_variances_down`,
    variances_serialized_up: `${filePrefix}_serialized_variances_up`,
    variances_serialized_down: `${filePrefix}_serialized_variances_down`,
    variances_all: `${filePrefix}_all_variances`,
    variances: `${filePrefix}_all_variances`,
    serials: `${filePrefix}_serials`,
    queries: `${filePrefix}_queries`,
    breakdowns: `${filePrefix}_breakdowns`,
    verifications: `${filePrefix}_verifications`,
    audit_log: `${filePrefix}_audit_log`,
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

// Human-readable action labels
const ACTION_LABELS: Record<string, string> = {
  create_count: "Count Created",
  update_count: "Count Updated",
  verification_count: "Verification Count Submitted",
  supervisor_edit_count: "Supervisor Edited Count",
  supervisor_accept_variance: "Variance Accepted",
  supervisor_reopen_variance: "Variance Reopened",
  assign_verification: "Verification Assigned",
  verification_accept_original: "Accepted Original Count",
  verification_accept_verification: "Accepted Verification Count",
  serial_edit_unknown: "Unknown Serial Edited",
  serial_edit_approved: "Approved Serial Edited",
  serial_approve_unknown: "Unknown Serial Approved",
  serial_dismiss_unknown: "Unknown Serial Dismissed",
  serial_update_unknowns: "Unknown Serials Updated",
  serial_override_expected: "Expected Serial Overridden",
  serial_assign_verification: "Serial Verification Assigned",
  serial_discrepancy_reopened: "Serial Discrepancy Reopened",
  serial_discrepancy_resolved: "Serial Discrepancy Resolved",
  serial_verification_completed: "Serial Verification Completed",
  query_resolved: "Query Resolved",
  query_reopened: "Query Reopened",
  query_responded: "Query Response Sent",
  query_deleted: "Query Deleted",
  query_team_message: "Team Query Message",
  breakdown_approved: "Breakdown Approved",
  breakdown_rejected: "Breakdown Rejected",
  breakdown_pending: "Breakdown Set Pending",
  breakdown_message: "Breakdown Message Sent",
  breakdown_deleted: "Breakdown Deleted",
  breakdown_team_message: "Team Breakdown Message",
};

async function buildAuditLogExport(eventId: number): Promise<Record<string, unknown>[]> {
  const logEntries = await db
    .select()
    .from(auditLog)
    .where(eq(auditLog.eventId, eventId))
    .orderBy(desc(auditLog.id));

  if (logEntries.length === 0) return [];

  // ── Resolve event name ──────────────────────────────────────────────────
  const [event] = await db.select({ name: stocktakeEvents.name }).from(stocktakeEvents).where(eq(stocktakeEvents.id, eventId));
  const eventName = event?.name ?? `Event #${eventId}`;

  // ── Resolve user names by type ──────────────────────────────────────────
  const userKeySet = new Set(logEntries.map((e) => `${e.userType}:${e.userId}`));
  const userNameMap: Record<string, string> = {};

  const userKeys = Array.from(userKeySet);
  const supervisorIds = userKeys.filter((k) => k.startsWith("supervisor:")).map((k) => Number(k.split(":")[1])).filter(Boolean);
  const teamIds = userKeys.filter((k) => k.startsWith("team:")).map((k) => Number(k.split(":")[1])).filter(Boolean);
  const adminIds = userKeys.filter((k) => k.startsWith("admin:")).map((k) => Number(k.split(":")[1])).filter(Boolean);
  const executiveIds = userKeys.filter((k) => k.startsWith("executive:")).map((k) => Number(k.split(":")[1])).filter(Boolean);

  if (supervisorIds.length > 0) {
    const rows = await db.select({ id: supervisors.id, name: supervisors.name }).from(supervisors).where(inArray(supervisors.id, supervisorIds));
    for (const r of rows) userNameMap[`supervisor:${r.id}`] = r.name;
  }
  if (teamIds.length > 0) {
    const rows = await db.select({ id: teams.id, name: teams.name }).from(teams).where(inArray(teams.id, teamIds));
    for (const r of rows) userNameMap[`team:${r.id}`] = r.name;
  }
  if (adminIds.length > 0) {
    const rows = await db.select({ id: admins.id, name: admins.name }).from(admins).where(inArray(admins.id, adminIds));
    for (const r of rows) userNameMap[`admin:${r.id}`] = r.name;
  }
  if (executiveIds.length > 0) {
    const rows = await db.select({ id: executives.id, name: executives.name }).from(executives).where(inArray(executives.id, executiveIds));
    for (const r of rows) userNameMap[`executive:${r.id}`] = r.name;
  }

  // ── Resolve item codes from recordId ────────────────────────────────────
  // For "counts" table: recordId is a count ID → join counts→items
  const countRecordIds = Array.from(new Set(
    logEntries.filter((e) => e.tableName === "counts" && e.recordId).map((e) => e.recordId!)
  ));
  const countItemMap: Record<number, { itemCode: string; description: string | null; binNumber: string | null }> = {};
  if (countRecordIds.length > 0) {
    const rows = await db
      .select({ countId: counts.id, itemCode: items.itemCode, description: items.description, binNumber: items.binNumber })
      .from(counts)
      .innerJoin(items, eq(counts.itemId, items.id))
      .where(inArray(counts.id, countRecordIds));
    for (const r of rows) countItemMap[r.countId] = { itemCode: r.itemCode, description: r.description, binNumber: r.binNumber };
  }

  // For "serial_discrepancies" table: recordId is a discrepancy ID → get itemCode directly
  const discRecordIds = Array.from(new Set(
    logEntries.filter((e) => e.tableName === "serial_discrepancies" && e.recordId).map((e) => e.recordId!)
  ));
  const discItemMap: Record<number, { itemCode: string; description: string | null; binNumber: string | null }> = {};
  if (discRecordIds.length > 0) {
    const rows = await db
      .select({ id: serialDiscrepancies.id, itemCode: serialDiscrepancies.itemCode, description: serialDiscrepancies.description, binNumber: serialDiscrepancies.binNumber })
      .from(serialDiscrepancies)
      .where(inArray(serialDiscrepancies.id, discRecordIds));
    for (const r of rows) discItemMap[r.id] = { itemCode: r.itemCode, description: r.description, binNumber: r.binNumber };
  }

  // For "verification_assignments" table: recordId → join to counts→items
  const vaRecordIds = Array.from(new Set(
    logEntries.filter((e) => e.tableName === "verification_assignments" && e.recordId).map((e) => e.recordId!)
  ));
  const vaItemMap: Record<number, { itemCode: string; description: string | null; binNumber: string | null }> = {};
  if (vaRecordIds.length > 0) {
    const rows = await db
      .select({ vaId: verificationAssignments.id, itemCode: items.itemCode, description: items.description, binNumber: items.binNumber })
      .from(verificationAssignments)
      .innerJoin(items, eq(verificationAssignments.itemId, items.id))
      .where(inArray(verificationAssignments.id, vaRecordIds));
    for (const r of rows) vaItemMap[r.vaId] = { itemCode: r.itemCode, description: r.description, binNumber: r.binNumber };
  }

  // For "queries" table: recordId → get itemCode from queries table
  const queryRecordIds = Array.from(new Set(
    logEntries.filter((e) => (e.tableName === "queries" || e.tableName === "query_messages") && e.recordId).map((e) => e.recordId!)
  ));
  const queryItemMap: Record<number, string> = {};
  if (queryRecordIds.length > 0) {
    const rows = await db
      .select({ id: queries.id, itemCode: queries.itemCode })
      .from(queries)
      .where(inArray(queries.id, queryRecordIds));
    for (const r of rows) if (r.itemCode) queryItemMap[r.id] = r.itemCode;
  }

  // For "breakdowns" / "breakdown_messages" table: recordId → get itemCode from breakdowns
  const bdRecordIds = Array.from(new Set(
    logEntries.filter((e) => (e.tableName === "breakdowns" || e.tableName === "breakdown_messages") && e.recordId).map((e) => e.recordId!)
  ));
  const bdItemMap: Record<number, string> = {};
  if (bdRecordIds.length > 0) {
    const rows = await db
      .select({ id: breakdowns.id, itemCode: breakdowns.itemCode })
      .from(breakdowns)
      .where(inArray(breakdowns.id, bdRecordIds));
    for (const r of rows) if (r.itemCode) bdItemMap[r.id] = r.itemCode;
  }

  // ── Build rows ──────────────────────────────────────────────────────────
  return logEntries.map((entry) => {
    const userKey = `${entry.userType}:${entry.userId}`;
    const userName = userNameMap[userKey] ?? `${entry.userType} #${entry.userId}`;
    const userTypeLabel = entry.userType ? entry.userType.charAt(0).toUpperCase() + entry.userType.slice(1) : "";

    // Resolve item code based on table
    let itemCode = "";
    let itemDescription = "";
    let binNumber = "";
    if (entry.tableName === "counts" && entry.recordId) {
      const ref = countItemMap[entry.recordId];
      if (ref) { itemCode = ref.itemCode; itemDescription = ref.description ?? ""; binNumber = ref.binNumber ?? ""; }
    } else if (entry.tableName === "serial_discrepancies" && entry.recordId) {
      const ref = discItemMap[entry.recordId];
      if (ref) { itemCode = ref.itemCode; itemDescription = ref.description ?? ""; binNumber = ref.binNumber ?? ""; }
    } else if (entry.tableName === "verification_assignments" && entry.recordId) {
      const ref = vaItemMap[entry.recordId];
      if (ref) { itemCode = ref.itemCode; itemDescription = ref.description ?? ""; binNumber = ref.binNumber ?? ""; }
    } else if ((entry.tableName === "queries" || entry.tableName === "query_messages") && entry.recordId) {
      itemCode = queryItemMap[entry.recordId] ?? "";
    } else if ((entry.tableName === "breakdowns" || entry.tableName === "breakdown_messages") && entry.recordId) {
      itemCode = bdItemMap[entry.recordId] ?? "";
    }

    // Parse old/new values for key details
    const oldParsed = entry.oldValue ? safeJsonParse<Record<string, unknown>>(entry.oldValue, {}) : {};
    const newParsed = entry.newValue ? safeJsonParse<Record<string, unknown>>(entry.newValue, {}) : {};

    // Extract most useful details from old/new values
    let details = "";
    if (entry.action === "supervisor_edit_count" || entry.action === "update_count") {
      details = `Qty: ${oldParsed.countedQty ?? "?"} → ${newParsed.countedQty ?? "?"}`;
      if (newParsed.reason) details += ` | Reason: ${newParsed.reason}`;
    } else if (entry.action === "create_count" || entry.action === "verification_count") {
      details = `Qty: ${newParsed.countedQty ?? "?"}, Variance: ${newParsed.variance ?? "?"}`;
    } else if (entry.action === "supervisor_accept_variance" || entry.action === "supervisor_reopen_variance") {
      details = `Status: ${newParsed.checkStatus ?? ""}`;
    } else if (entry.action === "serial_edit_unknown" || entry.action === "serial_edit_approved") {
      details = `Serial: ${oldParsed.serial ?? "?"} → ${newParsed.serial ?? "?"}`;
    } else if (entry.action === "serial_approve_unknown" || entry.action === "serial_dismiss_unknown") {
      details = `Serial: ${newParsed.serial ?? ""}`;
    } else if (entry.action === "serial_override_expected") {
      details = `Serial: ${newParsed.serialNumber ?? ""}, Qty: ${oldParsed.countedQty ?? "?"} → ${newParsed.countedQty ?? "?"}`;
    } else if (entry.action === "serial_discrepancy_resolved") {
      details = `Resolution: ${newParsed.resolution ?? ""}`;
    } else if (entry.action === "serial_assign_verification") {
      details = `Assigned team ID: ${newParsed.assignedTeamId ?? ""}`;
    } else if (entry.action === "query_resolved" || entry.action === "query_responded") {
      details = newParsed.response ? `Response: ${String(newParsed.response).substring(0, 200)}` : `Status: ${newParsed.status ?? ""}`;
    } else if (entry.action?.startsWith("breakdown_") && newParsed.status) {
      details = `Status: ${newParsed.status}`;
      if (newParsed.message) details += ` | Message: ${String(newParsed.message).substring(0, 200)}`;
    } else if (newParsed.message) {
      details = `Message: ${String(newParsed.message).substring(0, 200)}`;
    }

    return {
      "Log ID": entry.id,
      "Timestamp": entry.createdAt,
      "Event": eventName,
      "Action": ACTION_LABELS[entry.action] ?? entry.action,
      "Action Code": entry.action,
      "Performed By": userName,
      "User Type": userTypeLabel,
      "Item Code": itemCode,
      "Description": itemDescription,
      "Bin Number": binNumber,
      "Table": entry.tableName,
      "Record ID": entry.recordId,
      "Details": details,
      "Old Value (Raw)": entry.oldValue,
      "New Value (Raw)": entry.newValue,
    };
  });
}

function safeJsonParse<T>(json: string, fallback: T): T {
  try { return JSON.parse(json) as T; } catch { return fallback; }
}
