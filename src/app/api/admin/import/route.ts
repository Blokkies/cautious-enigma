import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { items, stocktakeEvents } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { parseExcel } from "@/lib/excel";

// GET: List events that have imported items (for "copy from" feature)
export async function GET() {
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
          .select({ count: sql<number>`count(*)` })
          .from(items)
          .where(eq(items.eventId, event.id));
        return { ...event, itemCount: Number(countRow?.count || 0) };
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
  try {
    const body = await request.json();
    const { sourceEventId, targetEventId } = body;

    if (!sourceEventId || !targetEventId) {
      return NextResponse.json({ error: "sourceEventId and targetEventId required" }, { status: 400 });
    }

    // Verify target event exists and is in setup
    const [targetEvent] = await db.select().from(stocktakeEvents).where(eq(stocktakeEvents.id, Number(targetEventId)));
    if (!targetEvent) return NextResponse.json({ error: "Target event not found" }, { status: 404 });
    if (targetEvent.status !== "setup") return NextResponse.json({ error: "Can only import during setup phase" }, { status: 400 });

    // Verify source event exists and has items
    const [sourceEvent] = await db.select().from(stocktakeEvents).where(eq(stocktakeEvents.id, Number(sourceEventId)));
    if (!sourceEvent) return NextResponse.json({ error: "Source event not found" }, { status: 404 });

    // Get all items from source event
    const sourceItems = await db.select().from(items).where(eq(items.eventId, Number(sourceEventId)));
    if (sourceItems.length === 0) return NextResponse.json({ error: "Source event has no items" }, { status: 400 });

    // Clear existing items in target event
    await db.delete(items).where(eq(items.eventId, Number(targetEventId)));

    // Copy items in batches (without team assignments)
    const BATCH_SIZE = 500;
    for (let i = 0; i < sourceItems.length; i += BATCH_SIZE) {
      const batch = sourceItems.slice(i, i + BATCH_SIZE);
      await db.insert(items).values(
        batch.map((item) => ({
          eventId: Number(targetEventId),
          internalId: item.internalId,
          itemCode: item.itemCode,
          description: item.description,
          brand: item.brand,
          category: item.category,
          binNumber: item.binNumber,
          binInternalId: item.binInternalId,
          warehouse: item.warehouse,
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

    // Copy warehouse config from source
    const warehouseRows = await db
      .select({ warehouse: items.warehouse })
      .from(items)
      .where(eq(items.eventId, Number(targetEventId)))
      .groupBy(items.warehouse);

    const warehouses = warehouseRows
      .map((r) => r.warehouse)
      .filter((w): w is string => !!w && w.trim().length > 0)
      .sort();

    await db.update(stocktakeEvents)
      .set({ warehouses: JSON.stringify(warehouses) })
      .where(eq(stocktakeEvents.id, Number(targetEventId)));

    // Summary stats
    const [totalImported] = await db.select({ count: sql<number>`count(*)` }).from(items).where(eq(items.eventId, Number(targetEventId)));
    const [uniqueBins] = await db.select({ count: sql<number>`count(DISTINCT bin_number)` }).from(items).where(eq(items.eventId, Number(targetEventId)));
    const [uniqueBrands] = await db.select({ count: sql<number>`count(DISTINCT brand)` }).from(items).where(eq(items.eventId, Number(targetEventId)));
    const [totalValue] = await db.select({ total: sql<number>`sum(total_value)` }).from(items).where(eq(items.eventId, Number(targetEventId)));

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
    console.error("Copy error:", error);
    return NextResponse.json({ error: "Failed to copy items" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;
    const eventId = formData.get("eventId") as string;

    if (!file || !eventId) {
      return NextResponse.json(
        { error: "File and eventId are required" },
        { status: 400 }
      );
    }

    // Verify event exists and is in setup status
    const events = await db
      .select()
      .from(stocktakeEvents)
      .where(eq(stocktakeEvents.id, Number(eventId)));

    const [event] = events;

    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    if (event.status !== "setup") {
      return NextResponse.json(
        { error: "Can only import data during setup phase" },
        { status: 400 }
      );
    }

    const buffer = await file.arrayBuffer();
    const parsed = parseExcel(buffer);

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

    // Clear existing items for this event
    await db.delete(items).where(eq(items.eventId, Number(eventId)));

    // Batch insert items
    const BATCH_SIZE = 500;
    for (let i = 0; i < parsed.items.length; i += BATCH_SIZE) {
      const batch = parsed.items.slice(i, i + BATCH_SIZE);
      await db.insert(items)
        .values(
          batch.map((item) => ({
            eventId: Number(eventId),
            internalId: item.internalId || null,
            itemCode: item.itemCode,
            description: item.description || null,
            brand: item.brand || null,
            category: item.category || null,
            binNumber: item.binNumber || null,
            binInternalId: item.binInternalId || null,
            warehouse: item.warehouse || null,
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

    // Get import summary
    const [totalImported] = await db
      .select({ count: sql<number>`count(*)` })
      .from(items)
      .where(eq(items.eventId, Number(eventId)));

    const [uniqueBins] = await db
      .select({ count: sql<number>`count(DISTINCT bin_number)` })
      .from(items)
      .where(eq(items.eventId, Number(eventId)));

    const [uniqueBrands] = await db
      .select({ count: sql<number>`count(DISTINCT brand)` })
      .from(items)
      .where(eq(items.eventId, Number(eventId)));

    const [totalValue] = await db
      .select({ total: sql<number>`sum(total_value)` })
      .from(items)
      .where(eq(items.eventId, Number(eventId)));

    // Auto-populate event warehouses from distinct warehouse values in imported items
    const warehouseRows = await db
      .select({ warehouse: items.warehouse })
      .from(items)
      .where(eq(items.eventId, Number(eventId)))
      .groupBy(items.warehouse);

    const warehouses = warehouseRows
      .map((r) => r.warehouse)
      .filter((w): w is string => !!w && w.trim().length > 0)
      .sort();

    await db.update(stocktakeEvents)
      .set({ warehouses: JSON.stringify(warehouses) })
      .where(eq(stocktakeEvents.id, Number(eventId)));

    return NextResponse.json({
      success: true,
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
    console.error("Import error:", error);
    return NextResponse.json(
      { error: "Failed to import file: " + (error instanceof Error ? error.message : "Unknown error") },
      { status: 500 }
    );
  }
}
