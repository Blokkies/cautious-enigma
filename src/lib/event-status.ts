// Event status transition rules for the admin endpoints.
// setup -> active is only possible via POST /api/admin/activate.

export const EVENT_STATUSES = ["setup", "active", "completed", "locked"] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export type TransitionCheck =
  | { ok: true; changed: boolean }
  | { ok: false; error: string };

// Status transitions allowed via PUT /api/admin/events (mirrors the admin UI).
const EVENTS_PUT_TRANSITIONS: Record<string, string[]> = {
  setup: [],
  active: ["setup", "completed"],
  completed: ["locked"],
  locked: ["active"],
};

/**
 * PUT /api/admin/events: may `from` change to `to`? `to` must already be a valid status.
 * Same status is allowed and reported as unchanged.
 */
export function checkEventsPutTransition(from: string, to: string): TransitionCheck {
  if (to === from) return { ok: true, changed: false };
  if (from === "setup" && to === "active") {
    return { ok: false, error: "Use the Activate action to activate an event" };
  }
  if (!(EVENTS_PUT_TRANSITIONS[from] || []).includes(to)) {
    return { ok: false, error: `Cannot change event status from ${from} to ${to}` };
  }
  return { ok: true, changed: true };
}

// PUT /api/admin/activate: required current status for each target status.
// Allowed: active -> setup (cancel), active -> completed, completed -> locked
const ACTIVATE_PUT_ALLOWED_FROM: Record<string, string> = {
  setup: "active",
  completed: "active",
  locked: "completed",
};

/** Target statuses accepted by PUT /api/admin/activate. */
export const ACTIVATE_PUT_TARGETS = ["setup", "completed", "locked"];

/**
 * PUT /api/admin/activate: may `from` change to `to`? `to` must already be one of
 * ACTIVATE_PUT_TARGETS. Same status is allowed (the row is still rewritten).
 */
export function checkActivatePutTransition(from: string, to: string): TransitionCheck {
  if (from !== to && ACTIVATE_PUT_ALLOWED_FROM[to] !== from) {
    return { ok: false, error: `Cannot change event status from ${from} to ${to}` };
  }
  return { ok: true, changed: from !== to };
}

/** POST /api/admin/activate: only events in setup can be activated. */
export function canActivate(from: string): boolean {
  return from === "setup";
}
