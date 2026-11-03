import { NextResponse } from "next/server";
import { checkEventActive } from "@/lib/api-auth";

/** Error code returned (HTTP 423) while the team's event is not accepting writes. */
export const EVENT_NOT_ACTIVE = "EVENT_NOT_ACTIVE";

/**
 * Write gate for team routes. Returns null when the event accepts writes,
 * otherwise the response to send.
 *
 * "Not active" (setup / completed / locked) is a *temporary* state: an admin
 * can cancel an event back to setup and reactivate it later. It is reported
 * as 423 Locked with code EVENT_NOT_ACTIVE so offline clients keep their
 * queued records and retry, instead of treating it as a definitive 403
 * rejection. A missing event stays a definitive 403.
 */
export async function teamEventGate(eventId: number): Promise<NextResponse | null> {
  const lockError = await checkEventActive(eventId);
  if (!lockError) return null;
  if (lockError === "Event not found") {
    return NextResponse.json({ error: lockError }, { status: 403 });
  }
  return NextResponse.json({ error: lockError, code: EVENT_NOT_ACTIVE }, { status: 423 });
}
