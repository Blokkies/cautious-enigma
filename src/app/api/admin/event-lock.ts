import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { stocktakeEvents } from "@/lib/db/schema";

/** A drizzle transaction handle (the argument of db.transaction's callback). */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Thrown inside a transaction to abort it (rolling back) and answer with a specific
 * HTTP status/body. Catch it with `routeErrorResponse`.
 */
export class RouteError extends Error {
  constructor(public status: number, public body: Record<string, unknown>) {
    super(typeof body.error === "string" ? body.error : `HTTP ${status}`);
    this.name = "RouteError";
  }
}

/** Response for a RouteError, or null if `error` is something else. */
export function routeErrorResponse(error: unknown): NextResponse | null {
  if (error instanceof RouteError) {
    return NextResponse.json(error.body, { status: error.status });
  }
  return null;
}

/**
 * Lock the event row (SELECT ... FOR UPDATE) for the rest of the transaction, so
 * status checks made here can't race with activation / import / reset.
 * Returns null if the event doesn't exist.
 */
export async function lockEventRow(tx: Tx, eventId: number) {
  const [event] = await tx
    .select({
      id: stocktakeEvents.id,
      status: stocktakeEvents.status,
      warehouses: stocktakeEvents.warehouses,
      uploadId: stocktakeEvents.uploadId,
    })
    .from(stocktakeEvents)
    .where(eq(stocktakeEvents.id, eventId))
    .for("update");
  return event ?? null;
}

/**
 * Same rule as checkEventWritable (event-guard.ts), for a status read under lockEventRow:
 * count-deleting writes are refused on completed/locked events, and non-admins may only
 * write while the event is in setup or active. Returns the error message, or null.
 */
export function eventWriteError(status: string, userType: string, deletesCounts = false): string | null {
  const closed = status === "completed" || status === "locked";
  if (deletesCounts && closed) {
    return "This stocktake is completed or locked. Count data cannot be deleted.";
  }
  if (userType !== "admin" && status !== "setup" && status !== "active") {
    return "This stocktake is completed or locked. No further changes are allowed.";
  }
  return null;
}

/** Parse the event's `warehouses` JSON (null / empty / invalid = all warehouses). */
export function parseEventWarehouses(raw: string | null | undefined): string[] | null {
  if (!raw) return null;
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) && list.length > 0 ? list.map(String) : null;
  } catch {
    return null;
  }
}
