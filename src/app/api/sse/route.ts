import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { counts, items, teams, stocktakeEvents } from "@/lib/db/schema";
import { eq, and, sql, isNotNull, gt, asc } from "drizzle-orm";
import { requireUser, getEventWarehouses, warehouseFilter, countsWarehouseFilter } from "@/lib/api-auth";
import { countInt } from "@/lib/db/aggregates";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireUser(request, { roles: ["supervisor"], status: 401 });
  if (auth.response) {
    // SSE clients get a plain-text body (EventSource ignores it anyway).
    return new Response("Unauthorized", { status: auth.response.status });
  }

  const eventId = auth.user.eventId;
  // Cursor on counts.id (serial, monotonic): countedAt is client-supplied and
  // can arrive out of order, so a timestamp cursor skips rows.
  let lastCountId = 0;
  const BATCH_SIZE = 50;

  const MAX_DURATION_MS = 30 * 60 * 1000; // 30 minutes max connection
  const POLL_INTERVAL_MS = 10_000; // 10 seconds between polls
  const startTime = Date.now();

  const encoder = new TextEncoder();
  let interval: ReturnType<typeof setInterval> | undefined;
  let closed = false;
  const stop = () => {
    closed = true;
    if (interval) clearInterval(interval);
  };

  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          );
        } catch {
          // Controller already closed (client went away)
          stop();
        }
      };

      const closeStream = (event: string, data: unknown) => {
        if (interval) clearInterval(interval);
        sendEvent(event, data);
        closed = true;
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      // Cleanup on close. Registered before any await so an abort during
      // setup is not missed.
      request.signal.addEventListener("abort", stop);
      if (request.signal.aborted) stop();

      // Send initial heartbeat
      sendEvent("connected", { time: new Date().toISOString() });

      const warehouses = await getEventWarehouses(eventId).catch(() => null);
      const cwf = countsWarehouseFilter(eventId, warehouses);

      // Start after the newest existing count: only stream counts made from now on.
      const [maxRow] = await db
        .select({ maxId: sql<number | null>`max(${counts.id})` })
        .from(counts)
        .where(eq(counts.eventId, eventId))
        .catch(() => [{ maxId: null }]);
      lastCountId = Number(maxRow?.maxId ?? 0);

      // The client may have gone away while we were awaiting above: stop() has
      // already run, so creating the interval now would leak it.
      if (closed) return;

      interval = setInterval(async () => {
        if (closed) {
          if (interval) clearInterval(interval);
          return;
        }
        try {
          // Auto-close after max duration
          if (Date.now() - startTime > MAX_DURATION_MS) {
            closeStream("timeout", { message: "Connection expired, please reconnect" });
            return;
          }

          // Check if event is still active
          const [event] = await db
            .select({ status: stocktakeEvents.status })
            .from(stocktakeEvents)
            .where(eq(stocktakeEvents.id, eventId));

          if (!event || event.status === "completed" || event.status === "locked") {
            closeStream("event-closed", { message: "Event has been completed or locked" });
            return;
          }

          // Check for new counts since last check
          const newCounts = await db
            .select({
              id: counts.id,
              teamName: teams.name,
              itemCode: items.itemCode,
              countedQty: counts.countedQty,
              variance: counts.variance,
              isMatch: counts.isMatch,
              countedAt: counts.countedAt,
            })
            .from(counts)
            .innerJoin(teams, eq(counts.teamId, teams.id))
            .innerJoin(items, eq(counts.itemId, items.id))
            .where(
              and(
                eq(counts.eventId, eventId),
                eq(counts.countType, "initial"),
                gt(counts.id, lastCountId),
                warehouseFilter(warehouses)
              )
            )
            .orderBy(asc(counts.id))
            .limit(BATCH_SIZE);

          if (newCounts.length > 0) {
            sendEvent("counts", newCounts);
            // Advance to the last id sent; anything beyond the batch comes next tick.
            lastCountId = newCounts[newCounts.length - 1].id;
          }

          // Overall progress (only assigned items in the event's selected warehouses)
          const [totalItems] = await db
            .select({ count: countInt() })
            .from(items)
            .where(and(eq(items.eventId, eventId), isNotNull(items.teamId), warehouseFilter(warehouses)));

          const [totalCounted] = await db
            .select({ count: countInt() })
            .from(counts)
            .where(and(eq(counts.eventId, eventId), eq(counts.countType, "initial"), cwf));

          const total = totalItems?.count ?? 0;
          const counted = totalCounted?.count ?? 0;

          sendEvent("progress", {
            total,
            counted,
            progressPercent:
              total > 0 ? Math.round((counted / total) * 100) : 0,
          });
        } catch {
          // DB error, skip this tick
        }
      }, POLL_INTERVAL_MS);
    },
    cancel() {
      stop();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
