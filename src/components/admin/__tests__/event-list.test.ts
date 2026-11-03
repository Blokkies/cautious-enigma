import { describe, expect, it } from "vitest";
import {
  countByStatus,
  eventZipName,
  filterEvents,
  groupEvents,
  isStatusFilter,
  parseTimestamp,
  setupChecklist,
  timeAgo,
} from "../event-list";

const ev = (id: number, status: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: `Event ${id}`,
  location: null as string | null,
  status,
  ...extra,
});

describe("groupEvents", () => {
  it("splits by status and orders each group", () => {
    const g = groupEvents([
      ev(1, "locked"),
      ev(2, "active", { progressPercent: 80 }),
      ev(3, "setup"),
      ev(4, "completed"),
      ev(5, "active", { progressPercent: 10 }),
      ev(6, "setup"),
      ev(7, "weird"),
    ]);
    expect(g.live.map((e) => e.id)).toEqual([5, 2]);
    expect(g.setup.map((e) => e.id)).toEqual([6, 3]);
    expect(g.finished.map((e) => e.id)).toEqual([4, 1]);
    expect(g.other.map((e) => e.id)).toEqual([7]);
  });
});

describe("countByStatus", () => {
  it("counts known statuses and the total", () => {
    expect(countByStatus([ev(1, "setup"), ev(2, "setup"), ev(3, "active"), ev(4, "locked"), ev(5, "x")])).toEqual({
      setup: 2,
      active: 1,
      completed: 0,
      locked: 1,
      total: 5,
    });
  });
});

describe("filterEvents", () => {
  const list = [
    { ...ev(1, "completed"), name: "Durban year end", location: "Durban DC" },
    { ...ev(2, "active"), name: "Cape Town cycle", location: "Montague Gardens" },
    { ...ev(3, "setup"), name: "Durban spot check", location: null },
  ];
  it("filters by status", () => {
    expect(filterEvents(list, "setup", "").map((e) => e.id)).toEqual([3]);
    expect(filterEvents(list, "all", "").map((e) => e.id)).toEqual([2, 3, 1]);
  });
  it("matches every word in name or location, case-insensitively", () => {
    expect(filterEvents(list, "all", "durban").map((e) => e.id)).toEqual([3, 1]);
    expect(filterEvents(list, "all", "DURBAN dc").map((e) => e.id)).toEqual([1]);
    expect(filterEvents(list, "all", "montague").map((e) => e.id)).toEqual([2]);
    expect(filterEvents(list, "completed", "cape")).toEqual([]);
  });
  it("validates filter values", () => {
    expect(isStatusFilter("locked")).toBe(true);
    expect(isStatusFilter("nope")).toBe(false);
    expect(isStatusFilter(null)).toBe(false);
  });
});

describe("setupChecklist", () => {
  it("counts finished steps out of five", () => {
    const empty = setupChecklist({ itemCount: 0, teamCount: 0, supervisorCount: 0, unassignedCount: 0 });
    expect(empty).toMatchObject({ completed: 1, total: 5, percent: 20, next: "items", ready: false });
    const ready = setupChecklist({ itemCount: 5, teamCount: 1, supervisorCount: 1, unassignedCount: 0 });
    expect(ready).toMatchObject({ completed: 5, percent: 100, next: "review", ready: true });
  });
});

describe("parseTimestamp / timeAgo", () => {
  it("reads Postgres and ISO timestamps", () => {
    expect(parseTimestamp("2026-11-03 10:15:22.123+00")?.toISOString()).toBe("2026-11-03T10:15:22.123Z");
    expect(parseTimestamp("2026-11-03 12:15:22+02")?.toISOString()).toBe("2026-11-03T10:15:22.000Z");
    expect(parseTimestamp("2026-11-03T10:15:22Z")?.toISOString()).toBe("2026-11-03T10:15:22.000Z");
    expect(parseTimestamp("2026-11-03 10:15:22")?.toISOString()).toBe("2026-11-03T10:15:22.000Z");
    expect(parseTimestamp("garbage")).toBeNull();
    expect(parseTimestamp(null)).toBeNull();
  });
  it("describes elapsed time", () => {
    const now = new Date("2026-11-03T12:00:00Z");
    expect(timeAgo("2026-11-03T11:59:30Z", now)).toBe("just now");
    expect(timeAgo("2026-11-03T11:55:00Z", now)).toBe("5 min ago");
    expect(timeAgo("2026-11-03 09:00:00+00", now)).toBe("3 h ago");
    expect(timeAgo("2026-11-02T11:00:00Z", now)).toBe("1 day ago");
    expect(timeAgo("2026-10-30T12:00:00Z", now)).toBe("4 days ago");
    expect(timeAgo(null, now)).toBe("");
  });
});

describe("eventZipName", () => {
  it("strips unsafe characters", () => {
    expect(eventZipName("Durban / DC: 2026")).toBe("Durban_DC_2026_all_exports.zip");
    expect(eventZipName("***")).toBe("stocktake_all_exports.zip");
  });
});
