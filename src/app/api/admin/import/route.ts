import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { items, stocktakeEvents, uploads, counts, verificationAssignments, serialDiscrepancies, queries, queryMessages, breakdowns, breakdownMessages, teamAssignments, auditLog, execMessages } from "@/lib/db/schema";
import { and, eq, notExists, sql } from "drizzle-orm";
import { normalizeWarehouse, parseExcel } from "@/lib/excel";
import { requireUser } from "@/lib/api-auth";
import { countInt, countDistinctInt, sumFloat } from "@/lib/db/aggregates";
import { lockEventRow, RouteError, routeErrorResponse, type Tx } from "../event-lock";

// Number of counts already recorded for an event (imports wipe them).
async function existingCountCount(eventId: number): Promise<number> {
  const [row] = await db
    .select({ count: countInt() })
    .from(counts)
    .where(eq(counts.eventId, eventId));
  return row?.count || 0;
}

function countsConfirmError(existingCounts: number) {
  return {
    error: `This event already has ${existingCounts} recorded counts. Importing will permanently delete them.`,
    existingCounts,
    requiresConfirm: true,
  };
}

/**
 * Inside the import/copy transaction: lock the event row and re-check that it is still
 * in setup (an activation may have happened since the pre-check) and that no counts
 * appeared that the caller hasn't confirmed deleting. Returns the locked row.
 */
async function lockEventForImport(tx: Tx, eid: number, confirm: boolean) {
  const event = await lockEventRow(tx, eid);
  if (!event) throw new RouteError(404, { error: "Event not found" });
  if (event.status !== "setup") {
    throw new RouteError(409, {
      error: `Event is no longer in setup (status: ${event.status}). Nothing was imported.`,
    });
  }
  if (!confirm) {
    const [row] = await tx.select({ count: countInt() }).from(counts).where(eq(counts.eventId, eid));
    const existing = row?.count || 0;
    if (existing > 0) throw new RouteError(409, countsConfirmError(existing));
  }
  return event;
}

/** Delete an event's items and every dependent record (counts, queries, ...). */
async function clearEventItems(tx: Tx, eid: number) {
  await tx.delete(execMessages).where(eq(execMessages.eventId, eid));
  await tx.delete(verificationAssignments).where(eq(verificationAssignments.eventId, eid));
  await tx.delete(auditLog).where(eq(auditLog.eventId, eid));
  await tx.delete(serialDiscrepancies).where(eq(serialDiscrepancies.eventId, eid));
  await tx.delete(breakdownMessages).where(sql`breakdown_id IN (SELECT id FROM breakdowns WHERE event_id = ${eid})`);
  await tx.delete(breakdowns).where(eq(breakdowns.eventId, eid));
  await tx.delete(queryMessages).where(sql`query_id IN (SELECT id FROM queries WHERE event_id = ${eid})`);
  await tx.delete(queries).where(eq(queries.eventId, eid));
  await tx.delete(counts).where(eq(counts.eventId, eid));
  await tx.delete(teamAssignments).where(eq(teamAssignments.eventId, eid));
  await tx.delete(items).where(eq(items.eventId, eid));
}

/** Distinct warehouses of the event's items (blank warehouses are stored as NO_WAREHOUSE). */
async function eventWarehouseList(tx: Tx, eid: number): Promise<string[]> {
  const rows = await tx
    .select({ warehouse: items.warehouse })
    .from(items)
    .where(eq(items.eventId, eid))
    .groupBy(items.warehouse);
  return rows
    .map((r) => r.warehouse)
    .filter((w): w is string => !!w && w.trim().length > 0)
    .sort();
}

/** Delete an upload that was replaced, unless another event still links to it. */
async function deleteReplacedUpload(tx: Tx, oldUploadId: number | null, newUploadId: number | null) {
  if (!oldUploadId || oldUploadId === newUploadId) return;
  await tx.delete(uploads).where(
    and(
      eq(uploads.id, oldUploadId),
      notExists(
        tx.select({ id: stocktakeEvents.id }).from(stocktakeEvents).where(eq(stocktakeEvents.uploadId, oldUploadId))
      )
    )
  );
}

// GET: List events that have imported items (for "copy from" feature)
export async function GET(request: NextRequest) {
  const auth = await requireUser(request, { roles: ["admin"] });
  if (auth.response) return auth.response;

  try {
    const allEvents = await db
      .select({
        id: stocktakeEvents.id,
        name: stocktakeEvents.name,
        status: stocktakeEvents.status,
      })
      .from(stocktakeEvents);

    const eventsWithItems = await Promise.all(
      allEvents.map(async (event) => {
        const [countRow] = await db
          .select({ count: countInt() })
          .from(items)
          .where(eq(items.eventId, event.id));
        return { ...event, itemCount: countRow?.count || 0 };
      })
    );

    return NextResponse.json({
      events: eventsWithItems.filter((e) => e.itemCount > 0),
    });
  } catch (error) {
    console.error("Error listing events:", error);
    return NextResponse.json({ error: "Failed to list events" }, { status: 500 });
  }
}

// PUT: Copy items from one event to another
export async function PUT(request: NextRequest) {
  const auth = await requireUser(request, { roles: ["admin"], write: true });
  if (auth.response) return auth.response;

  try {
    const body = await request.json();
    const { sourceEventId, targetEventId, confirm } = body;

    if (!sourceEventId || !targetEventId) {
      return NextResponse.json({ error: "sourceEventId and targetEventId required" }, { status: 400 });
    }

    // Verify target event exists and is in setup (re-checked under a lock in the transaction)
    const [targetEvent] = await db.select().from(stocktakeEvents).where(eq(stocktakeEvents.id, Number(targetEventId)));
    if (!targetEvent) return NextResponse.json({ error: "Target event not found" }, { status: 404 });
    if (targetEvent.status !== "setup") return NextResponse.json({ error: "Can only import during setup phase" }, { status: 400 });

    const existingCounts = await existingCountCount(Number(targetEventId));
    if (existingCounts > 0 && confirm !== true) {
      return NextResponse.json(countsConfirmError(existingCounts), { status: 409 });
    }

    // Verify source event exists and has items
    const [sourceEvent] = await db.select().from(stocktakeEvents).where(eq(stocktakeEvents.id, Number(sourceEventId)));
    if (!sourceEvent) return NextResponse.json({ error: "Source event not found" }, { status: 404 });

    // Get all items from source event
    const sourceItems = await db.select().from(items).where(eq(items.eventId, Number(sourceEventId)));
    if (sourceItems.length === 0) return NextResponse.json({ error: "Source event has no items" }, { status: 400 });

    // Clear existing items and all dependent records, then copy items — all in one transaction
    const eid = Number(targetEventId);
    const warehouses = await db.transaction(async (tx) => {
      // Re-check status under a row lock so activation can't slip in between
      const locked = await lockEventForImport(tx, eid, confirm === true);
      await clearEventItems(tx, eid);

      // Copy items in batches (without team assignments)
      const BATCH_SIZE = 500;
      for (let i = 0; i < sourceItems.length; i += BATCH_SIZE) {
        const batch = sourceItems.slice(i, i + BATCH_SIZE);
        await tx.insert(items).values(
          batch.map((item) => ({
            eventId: eid,
            internalId: item.internalId,
            itemCode: item.itemCode,
            description: item.description,
            brand: item.brand,
            category: item.category,
            binNumber: item.binNumber,
            binInternalId: item.binInternalId,
            // Older imports stored blank warehouses as NULL; normalize so filters can select them
            warehouse: normalizeWarehouse(item.warehouse),
            division: item.division,
            onHand: item.onHand,
            avgCost: item.avgCost,
            totalValue: item.totalValue,
            stockStatus: item.stockStatus,
            serialNumber: item.serialNumber,
            isSerialized: item.isSerialized,
            teamId: null, // Don't copy team assignments
          }))
        );
      }

      const whs = await eventWarehouseList(tx, eid);

      // Link the source's upload file (or none); the target's previous file no longer
      // describes its items, so drop it if nothing else links to it.
      const newUploadId = sourceEvent.uploadId ?? null;
      await tx.update(stocktakeEvents)
        .set({ warehouses: JSON.stringify(whs), uploadId: newUploadId })
        .where(eq(stocktakeEvents.id, eid));
      await deleteReplacedUpload(tx, locked.uploadId, newUploadId);
      return whs;
    });

    // Summary stats
    const [totalImported] = await db.select({ count: countInt() }).from(items).where(eq(items.eventId, eid));
    const [uniqueBins] = await db.select({ count: countDistinctInt(sql`bin_number`) }).from(items).where(eq(items.eventId, eid));
    const [uniqueBrands] = await db.select({ count: countDistinctInt(sql`brand`) }).from(items).where(eq(items.eventId, eid));
    const [totalValue] = await db.select({ total: sumFloat(sql`total_value`) }).from(items).where(eq(items.eventId, eid));

    return NextResponse.json({
      success: true,
      summary: {
        totalItems: totalImported?.count || 0,
        uniqueBins: uniqueBins?.count || 0,
        uniqueBrands: uniqueBrands?.count || 0,
        totalValue: totalValue?.total || 0,
        warehouses,
      },
    });
  } catch (error) {
    const routeError = routeErrorResponse(error);
    if (routeError) return routeError;
    console.error("Copy error:", error);
    return NextResponse.json({ error: "Failed to copy items" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireUser(request, { roles: ["admin"], write: true });
  if (auth.response) return auth.response;
  const { user } = auth;

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;
    const eventId = formData.get("eventId") as string;
    const confirm = formData.get("confirm") === "true";

    if (!file || !eventId) {
      return NextResponse.json(
        { error: "File and eventId are required" },
        { status: 400 }
      );
    }

    // Limit file size to 50MB to prevent memory exhaustion
    const MAX_FILE_SIZE = 50 * 1024 * 1024;
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "File too large. Maximum size is 50MB." },
        { status: 413 }
      );
    }

    // Verify event exists and is in setup status (re-checked under a lock in the transaction)
    const [event] = await db
      .select()
      .from(stocktakeEvents)
      .where(eq(stocktakeEvents.id, Number(eventId)));

    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    if (event.status !== "setup") {
      return NextResponse.json(
        { error: "Can only import data during setup phase" },
        { status: 400 }
      );
    }

    const existingCounts = await existingCountCount(Number(eventId));
    if (existingCounts > 0 && !confirm) {
      return NextResponse.json(countsConfirmError(existingCounts), { status: 409 });
    }

    const buffer = await file.arrayBuffer();
    const parsed = parseExcel(buffer, { filename: file.name, mimeType: file.type });

    if (parsed.items.length === 0) {
      return NextResponse.json(
        {
          error: "No valid items found in file",
          headers: parsed.headers,
          mappedFields: parsed.mappedFields,
          unmappedHeaders: parsed.unmappedHeaders,
        },
        { status: 400 }
      );
    }

    // Clear existing items and all dependent records, then insert — all in one transaction
    const eid = Number(eventId);
    const fileBase64 = Buffer.from(buffer).toString("base64");
    const { upload, warehouses } = await db.transaction(async (tx) => {
      // Re-check status under a row lock so activation can't slip in between
      const locked = await lockEventForImport(tx, eid, confirm);
      await clearEventItems(tx, eid);

      // Batch insert items
      const BATCH_SIZE = 500;
      for (let i = 0; i < parsed.items.length; i += BATCH_SIZE) {
        const batch = parsed.items.slice(i, i + BATCH_SIZE);
        await tx.insert(items)
          .values(
            batch.map((item) => ({
              eventId: eid,
              internalId: item.internalId || null,
              itemCode: item.itemCode,
              description: item.description || null,
              brand: item.brand || null,
              category: item.category || null,
              binNumber: item.binNumber || null,
              binInternalId: item.binInternalId || null,
              // Blank warehouse -> "(No warehouse)" so warehouse filters can still select it
              warehouse: normalizeWarehouse(item.warehouse),
              division: item.division || null,
              onHand: item.onHand || 0,
              avgCost: item.avgCost || 0,
              totalValue: item.totalValue || 0,
              stockStatus: item.stockStatus || null,
              serialNumber: item.serialNumber || null,
              isSerialized: !!item.serialNumber,
            }))
          );
      }

      // Store uploaded file in database
      const [up] = await tx.insert(uploads).values({
        filename: file.name,
        fileSize: file.size,
        fileData: fileBase64,
        mimeType: file.type || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        uploadedBy: user.id ? Number(user.id) : null,
      }).returning({ id: uploads.id });

      // Auto-populate event warehouses from distinct warehouse values in imported items
      const whs = await eventWarehouseList(tx, eid);

      await tx.update(stocktakeEvents)
        .set({ warehouses: JSON.stringify(whs), uploadId: up.id })
        .where(eq(stocktakeEvents.id, eid));
      // The previous upload is replaced; remove it unless another event still links to it
      await deleteReplacedUpload(tx, locked.uploadId, up.id);

      return { upload: up, warehouses: whs };
    });

    // Get import summary
    const [totalImported] = await db
      .select({ count: countInt() })
      .from(items)
      .where(eq(items.eventId, eid));

    const [uniqueBins] = await db
      .select({ count: countDistinctInt(sql`bin_number`) })
      .from(items)
      .where(eq(items.eventId, eid));

    const [uniqueBrands] = await db
      .select({ count: countDistinctInt(sql`brand`) })
      .from(items)
      .where(eq(items.eventId, eid));

    const [totalValue] = await db
      .select({ total: sumFloat(sql`total_value`) })
      .from(items)
      .where(eq(items.eventId, eid));

    return NextResponse.json({
      success: true,
      uploadId: upload.id,
      summary: {
        totalItems: totalImported?.count || 0,
        uniqueBins: uniqueBins?.count || 0,
        uniqueBrands: uniqueBrands?.count || 0,
        totalValue: totalValue?.total || 0,
        warehouses,
        mappedFields: parsed.mappedFields,
        unmappedHeaders: parsed.unmappedHeaders,
        rawRowCount: parsed.rowCount,
      },
    });
  } catch (error) {
    const routeError = routeErrorResponse(error);
    if (routeError) return routeError;
    console.error("Import error:", error);
    return NextResponse.json(
      { error: "Failed to import file: " + (error instanceof Error ? error.message : "Unknown error") },
      { status: 500 }
    );
  }
}
