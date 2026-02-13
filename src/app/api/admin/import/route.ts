import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { items, stocktakeEvents } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { parseExcel } from "@/lib/excel";

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

    return NextResponse.json({
      success: true,
      summary: {
        totalItems: totalImported?.count || 0,
        uniqueBins: uniqueBins?.count || 0,
        uniqueBrands: uniqueBrands?.count || 0,
        totalValue: totalValue?.total || 0,
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
