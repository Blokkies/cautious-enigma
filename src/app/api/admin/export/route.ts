import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { items, stocktakeEvents } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import * as XLSX from "xlsx";
import { getApiUser, getEventWarehouses, warehouseFilter } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
  const user = getApiUser(request);
  if (!user || user.type !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const eventId = request.nextUrl.searchParams.get("eventId");
  if (!eventId) {
    return NextResponse.json({ error: "eventId required" }, { status: 400 });
  }

  const eid = Number(eventId);

  const events = await db
    .select()
    .from(stocktakeEvents)
    .where(eq(stocktakeEvents.id, eid));

  const [event] = events;

  if (!event) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  const warehouses = await getEventWarehouses(eid);

  const rows = await db
    .select({
      internalId: items.internalId,
      itemCode: items.itemCode,
      description: items.description,
      brand: items.brand,
      category: items.category,
      binNumber: items.binNumber,
      binInternalId: items.binInternalId,
      warehouse: items.warehouse,
      division: items.division,
      onHand: items.onHand,
      avgCost: items.avgCost,
      totalValue: items.totalValue,
      stockStatus: items.stockStatus,
      serialNumber: items.serialNumber,
      isSerialized: items.isSerialized,
    })
    .from(items)
    .where(and(eq(items.eventId, eid), warehouseFilter(warehouses)));

  const exportRows = rows.map((r) => ({
    "Internal ID": r.internalId || "",
    "Item Code": r.itemCode,
    "Description": r.description || "",
    "Brand": r.brand || "",
    "Category": r.category || "",
    "Bin Number": r.binNumber || "",
    "Bin Internal ID": r.binInternalId || "",
    "Warehouse": r.warehouse || "",
    "Division": r.division || "",
    "On Hand": r.onHand ?? 0,
    "Avg Cost": r.avgCost ?? 0,
    "Total Value": r.totalValue ?? 0,
    "Stock Status": r.stockStatus || "",
    "Serial Number": r.serialNumber || "",
    "Is Serialized": r.isSerialized ? "Yes" : "No",
  }));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(exportRows);
  XLSX.utils.book_append_sheet(wb, ws, "Items");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  const safeName = event.name.replace(/[^a-zA-Z0-9_-]/g, "_");

  return new NextResponse(buf as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${safeName}_items.xlsx"`,
    },
  });
}
