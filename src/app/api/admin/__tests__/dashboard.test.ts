import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { QueryRecord } from "./mock-db";

const state = vi.hoisted(() => ({
  respond: (() => []) as (rec: QueryRecord) => unknown,
  mock: null as null | ReturnType<typeof import("./mock-db").createMockDb>,
}));

vi.mock("@/lib/db", async () => {
  const { createMockDb } = await import("./mock-db");
  state.mock = createMockDb((rec) => state.respond(rec));
  return { db: state.mock.db };
});

import { ADMIN_HEADERS, callArgs, hasCall, sqlText } from "./mock-db";
import { GET } from "../dashboard/route";

const EVENTS = [
  { id: 1, name: "Setup one", location: "JHB", status: "setup", startDate: null, endDate: null, warehouses: null },
  { id: 2, name: "Live", location: null, status: "active", startDate: "2026-11-01", endDate: "2026-11-02", warehouses: null },
  { id: 3, name: "Done", location: null, status: "completed", startDate: null, endDate: null, warehouses: null },
  { id: 4, name: "Locked", location: null, status: "locked", startDate: null, endDate: null, warehouses: null },
];

beforeEach(() => {
  state.mock!.reset();
  state.respond = (rec) => {
    if (rec.table === "admins") return [{ id: 1 }];
    if (rec.op === "select" && rec.table === "stocktake_events") {
      // Full list (no projection) vs getEventWarehouses' projection
      return rec.fields.length === 0 ? EVENTS : [{ warehouses: null }];
    }
    if (rec.op === "select" && rec.table === "items") {
      // readiness: unassigned query filters on team IS NULL; give it a distinct number
      const where = sqlText(callArgs(rec, "where")?.[0]);
      return [{ count: where.includes("is null") ? 7 : 40 }];
    }
    if (rec.op === "select" && rec.table === "teams") return [{ count: 3 }];
    if (rec.op === "select" && rec.table === "supervisors") return [{ count: 2 }];
    if (rec.op === "select" && rec.table === "counts" && rec.fields.includes("at")) return [{ at: "2026-11-01 10:00:00" }];
    if (rec.op === "select" && rec.table === "counts") return [{ count: 5, total: 100 }];
    if (rec.op === "select" && hasCall(rec, "where")) return [{ count: 0 }];
    return [];
  };
});

describe("GET /api/admin/dashboard", () => {
  it("returns every event with its real status", async () => {
    const res = await GET(new NextRequest("http://localhost/api/admin/dashboard", { headers: ADMIN_HEADERS }));
    expect(res.status).toBe(200);
    const { events } = await res.json();
    expect(events.map((e: { id: number; status: string }) => [e.id, e.status])).toEqual([
      [1, "setup"],
      [2, "active"],
      [3, "completed"],
      [4, "locked"],
    ]);
  });

  it("adds setup-progress counts to setup events only", async () => {
    const { events } = await (await GET(new NextRequest("http://localhost/api/admin/dashboard", { headers: ADMIN_HEADERS }))).json();
    const [setup, live] = events;
    expect(setup.setup).toEqual({ itemCount: 40, teamCount: 3, supervisorCount: 2, unassignedCount: 7 });
    expect(setup.countedItems).toBe(0);
    expect(setup.progressPercent).toBe(0);
    expect(setup.lastCountAt).toBeNull();
    expect(live.setup).toBeNull();
    expect(live.endDate).toBe("2026-11-02");
    expect(live.lastCountAt).toBe("2026-11-01 10:00:00");
    expect(live.teamCount).toBe(3);
  });

  it("does not run count statistics for setup events", async () => {
    await GET(new NextRequest("http://localhost/api/admin/dashboard", { headers: ADMIN_HEADERS }));
    // 3 non-setup events each query counts; the setup event adds none
    const countQueries = state.mock!.log.filter((r) => r.table === "counts");
    expect(countQueries.length % 3).toBe(0);
    expect(countQueries.length).toBeGreaterThan(0);
  });
});
