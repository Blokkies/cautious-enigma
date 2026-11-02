import { describe, expect, it } from "vitest";
import {
  ACTIVATE_PUT_TARGETS,
  EVENT_STATUSES,
  canActivate,
  checkActivatePutTransition,
  checkEventsPutTransition,
} from "./event-status";

type Pair = [from: string, to: string];

function allowedChanges(check: (f: string, t: string) => { ok: boolean }, targets: readonly string[]) {
  const pairs: Pair[] = EVENT_STATUSES.flatMap((from) => targets.map((to) => [from, to] as Pair));
  return pairs
    .filter(([f, t]) => f !== t && check(f, t).ok)
    .map(([f, t]) => `${f}->${t}`)
    .sort();
}

describe("EVENT_STATUSES", () => {
  it("lists the four lifecycle statuses", () => {
    expect([...EVENT_STATUSES]).toEqual(["setup", "active", "completed", "locked"]);
  });
});

describe("checkEventsPutTransition (PUT /api/admin/events)", () => {
  it("allows exactly active->setup, active->completed, completed->locked, locked->active", () => {
    expect(allowedChanges(checkEventsPutTransition, EVENT_STATUSES)).toEqual(
      ["active->completed", "active->setup", "completed->locked", "locked->active"].sort()
    );
  });

  it("treats same-status as an allowed no-op", () => {
    for (const s of EVENT_STATUSES) {
      expect(checkEventsPutTransition(s, s)).toEqual({ ok: true, changed: false });
    }
  });

  it("marks allowed changes as changed", () => {
    expect(checkEventsPutTransition("locked", "active")).toEqual({ ok: true, changed: true });
  });

  it("points setup->active at the Activate action", () => {
    expect(checkEventsPutTransition("setup", "active")).toEqual({
      ok: false,
      error: "Use the Activate action to activate an event",
    });
  });

  it("rejects other transitions with a descriptive error", () => {
    expect(checkEventsPutTransition("completed", "active")).toEqual({
      ok: false,
      error: "Cannot change event status from completed to active",
    });
    expect(checkEventsPutTransition("locked", "setup").ok).toBe(false);
  });

  it("rejects any change from an unknown current status", () => {
    expect(checkEventsPutTransition("archived", "setup").ok).toBe(false);
  });
});

describe("checkActivatePutTransition (PUT /api/admin/activate)", () => {
  it("accepts only setup/completed/locked as targets", () => {
    expect(ACTIVATE_PUT_TARGETS).toEqual(["setup", "completed", "locked"]);
  });

  it("allows exactly active->setup, active->completed, completed->locked", () => {
    expect(allowedChanges(checkActivatePutTransition, ACTIVATE_PUT_TARGETS)).toEqual(
      ["active->completed", "active->setup", "completed->locked"].sort()
    );
  });

  it("cannot re-open a locked event (unlike PUT /api/admin/events)", () => {
    expect(ACTIVATE_PUT_TARGETS.includes("active")).toBe(false);
    expect(checkActivatePutTransition("locked", "setup").ok).toBe(false);
  });

  it("allows same-status updates", () => {
    for (const s of ACTIVATE_PUT_TARGETS) {
      expect(checkActivatePutTransition(s, s)).toEqual({ ok: true, changed: false });
    }
  });

  it("rejects with a descriptive error", () => {
    expect(checkActivatePutTransition("setup", "completed")).toEqual({
      ok: false,
      error: "Cannot change event status from setup to completed",
    });
  });
});

describe("canActivate (POST /api/admin/activate)", () => {
  it("only activates events in setup", () => {
    expect(EVENT_STATUSES.filter(canActivate)).toEqual(["setup"]);
  });
});
