// Validation for editable event details (name, location, start/end dates).
// Used by POST/PUT /api/admin/events. Pure: no DB access.

export const EVENT_NAME_MAX = 200;
export const EVENT_LOCATION_MAX = 200;

export interface EventDetails {
  name: string;
  location: string | null;
  startDate: string | null;
  endDate: string | null;
}

export type DetailsResult =
  | { ok: true; updates: Partial<EventDetails> }
  | { ok: false; error: string };

const DETAIL_KEYS = ["name", "location", "startDate", "endDate"] as const;

/** True if the request body contains any of the editable detail fields. */
export function hasDetailFields(body: Record<string, unknown>): boolean {
  return DETAIL_KEYS.some((k) => body[k] !== undefined);
}

/** A real calendar date as YYYY-MM-DD (time part, if any, is dropped). */
export function parseIsoDate(value: unknown): string | null | undefined {
  if (value === null || value === "") return null;
  if (typeof value !== "string") return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/.exec(value.trim());
  if (!m) return undefined;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return undefined;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/**
 * Validate the detail fields present in `body`. Absent fields are left out of `updates`.
 * `existing` supplies the current dates so a single changed date is still checked against
 * the other one (end date must not be before start date).
 */
export function validateEventDetails(
  body: Record<string, unknown>,
  existing: Pick<EventDetails, "startDate" | "endDate"> = { startDate: null, endDate: null }
): DetailsResult {
  const updates: Partial<EventDetails> = {};

  if (body.name !== undefined) {
    if (typeof body.name !== "string" || body.name.trim() === "") {
      return { ok: false, error: "Event name is required" };
    }
    const name = body.name.trim();
    if (name.length > EVENT_NAME_MAX) {
      return { ok: false, error: `Event name must be at most ${EVENT_NAME_MAX} characters` };
    }
    updates.name = name;
  }

  if (body.location !== undefined) {
    if (body.location !== null && typeof body.location !== "string") {
      return { ok: false, error: "Location must be text" };
    }
    const location = typeof body.location === "string" ? body.location.trim() : "";
    if (location.length > EVENT_LOCATION_MAX) {
      return { ok: false, error: `Location must be at most ${EVENT_LOCATION_MAX} characters` };
    }
    updates.location = location || null;
  }

  for (const key of ["startDate", "endDate"] as const) {
    if (body[key] === undefined) continue;
    const parsed = parseIsoDate(body[key]);
    if (parsed === undefined) {
      return { ok: false, error: `${key === "startDate" ? "Start" : "End"} date must be a date (YYYY-MM-DD) or empty` };
    }
    updates[key] = parsed;
  }

  const start = updates.startDate !== undefined ? updates.startDate : parseIsoDate(existing.startDate) ?? null;
  const end = updates.endDate !== undefined ? updates.endDate : parseIsoDate(existing.endDate) ?? null;
  if ((updates.startDate !== undefined || updates.endDate !== undefined) && start && end && end < start) {
    return { ok: false, error: "End date cannot be before the start date" };
  }

  return { ok: true, updates };
}
