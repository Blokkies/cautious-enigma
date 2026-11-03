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

import { ADMIN_HEADERS, callArgs, sqlQuery, sqlText } from "./mock-db";
import { DELETE as assignDELETE, PATCH as assignPATCH, POST as assignPOST } from "../assign/route";
import { binRefsCondition, itemScopeFragment, parseBinRefs } from "../assign/bins";
import { DELETE as teamsDELETE } from "../teams/route";
import { DELETE as eventsDELETE } from "../events/route";
import { sql } from "drizzle-orm";

const log = () => state.mock!.log;

interface Scenario {
  status?: string;
  warehouses?: string[] | null;
  countedCount?: number;
  supervisorHistory?: number;
  eventCounts?: number;
}

function scenario(s: Scenario = {}) {
  state.respond = (rec) => {
    if (rec.table === "admins") return [{ id: 1 }];
    if (rec.op === "select" && rec.table === "stocktake_events") {
      if (rec.fields.length === 1 && rec.fields[0] === "warehouses") {
        return [{ warehouses: s.warehouses ? JSON.stringify(s.warehouses) : null }];
      }
      return [{ id: 5, status: s.status ?? "active", warehouses: null, uploadId: null }];
    }
    if (rec.op === "select" && rec.table === "teams") return [{ id: 7 }, { id: 8 }];
    if (rec.op === "select" && rec.table === "supervisors") return [{ eventId: 5 }];
    if (rec.op === "select" && rec.table === "verification_assignments") return [{ count: s.supervisorHistory ?? 0 }];
    if (rec.op === "select" && rec.table === "counts") return [{ count: s.eventCounts ?? 0 }];
    if (rec.op === "execute" && rec.text?.includes("count(*)::int as cnt")) return [{ cnt: s.countedCount ?? 0 }];
    if (rec.op === "execute" && rec.text?.includes("RETURNING id")) return [{ id: 1 }, { id: 2 }];
    return [];
  };
}

function req(method: string, body: unknown, url = "http://localhost/api/admin/assign") {
  return new NextRequest(url, { method, headers: ADMIN_HEADERS, body: JSON.stringify(body) });
}

const txExecutes = () => log().filter((r) => r.op === "execute" && r.inTx);

beforeEach(() => {
  state.mock!.reset();
  scenario();
});

describe("bin helpers", () => {
  it("parses object and legacy string bins, rejecting malformed entries", () => {
    expect(parseBinRefs([{ warehouse: "JHB", bin: "A-01" }, { warehouse: null, bin_number: "B" }, "C"])).toEqual([
      { warehouse: "JHB", bin: "A-01" },
      { warehouse: null, bin: "B" },
      { bin: "C" },
    ]);
    expect(parseBinRefs("A-01")).toBeNull();
    expect(parseBinRefs([{ warehouse: 3, bin: "A" }])).toBeNull();
    expect(parseBinRefs([{ warehouse: "JHB" }])).toBeNull();
  });

  it("matches bins by (warehouse, bin_number); legacy strings match the bin number only", () => {
    const q = sqlQuery(sql`${binRefsCondition([{ warehouse: "JHB", bin: "A-01" }, { warehouse: null, bin: "A-02" }, { bin: "A-03" }], "i")}`);
    expect(q.sql).toBe(
      "((COALESCE(i.warehouse, '') = $1 AND i.bin_number = $2) OR (COALESCE(i.warehouse, '') = $3 AND i.bin_number = $4) OR (i.bin_number = $5))"
    );
    expect(q.params).toEqual(["JHB", "A-01", "", "A-02", "A-03"]);
    expect(sqlText(sql`${binRefsCondition([])}`)).toBe("FALSE");
  });

  it("builds the warehouse/brand scope fragment", () => {
    const q = sqlQuery(sql`x${itemScopeFragment(["JHB", "CPT"], "Acme")}`);
    expect(q.sql).toBe("x AND warehouse IN ($1, $2) AND brand = $3");
    expect(q.params).toEqual(["JHB", "CPT", "Acme"]);
    expect(sqlText(sql`x${itemScopeFragment(null, null)}`)).toBe("x");
  });
});

describe("POST /api/admin/assign", () => {
  it("assigns only the given (warehouse, bin) within the event warehouses and brand filter", async () => {
    scenario({ warehouses: ["JHB"] });
    const res = await assignPOST(req("POST", { eventId: 5, teamId: 7, bins: [{ warehouse: "JHB", bin: "A-01" }], brand: "Acme" }));
    expect(res.status).toBe(200);
    const update = log().find((r) => r.op === "execute" && r.text?.startsWith("UPDATE items"))!;
    expect(update.text).toContain("COALESCE(warehouse, '') = $");
    expect(update.text).toContain("warehouse IN ($");
    expect(update.text).toContain("brand = $");
    expect(update.text).toContain("team_id IS NULL");
  });

  it("still accepts legacy bin-number strings", async () => {
    const res = await assignPOST(req("POST", { eventId: 5, teamId: 7, bins: ["A-01"] }));
    expect(res.status).toBe(200);
    expect((await res.json()).assignedCount).toBe(2);
  });

  it("applies the scope to auto-balance too", async () => {
    scenario({ warehouses: ["JHB"] });
    const res = await assignPOST(
      req("POST", { eventId: 5, action: "auto-balance", brand: "Acme", assignments: [{ teamId: 7, bins: [{ warehouse: "JHB", bin: "A-01" }] }] })
    );
    expect(res.status).toBe(200);
    const update = txExecutes().find((r) => r.text?.startsWith("UPDATE items"))!;
    expect(update.text).toContain("warehouse IN ($");
    expect(update.text).toContain("brand = $");
  });
});

describe("DELETE /api/admin/assign with clearCounts", () => {
  it("deletes the team's serial discrepancies for the bins in the same transaction", async () => {
    scenario({ countedCount: 2 });
    const res = await assignDELETE(
      req("DELETE", { eventId: 5, teamId: 7, bins: [{ warehouse: "JHB", bin: "A-01" }], clearCounts: true })
    );
    expect(res.status).toBe(200);
    const texts = txExecutes().map((r) => r.text!);
    expect(texts.some((t) => t.startsWith("DELETE FROM verification_assignments"))).toBe(true);
    expect(texts.some((t) => t.startsWith("DELETE FROM counts"))).toBe(true);
    const sd = texts.find((t) => t.startsWith("DELETE FROM serial_discrepancies"))!;
    expect(sd).toContain("sd.team_id = $");
    expect(sd).toContain("i.bin_number IS NOT DISTINCT FROM sd.bin_number");
    expect(sd).toContain("COALESCE(i.warehouse, '') = $");
    // Discrepancies are removed before the items are unassigned
    expect(texts.findIndex((t) => t.startsWith("DELETE FROM serial_discrepancies"))).toBeLessThan(
      texts.findIndex((t) => t.startsWith("UPDATE items"))
    );
  });

  it("deletes all of the team's serial discrepancies when unassigning the whole team", async () => {
    scenario({ countedCount: 1 });
    const res = await assignDELETE(req("DELETE", { eventId: 5, teamId: 7, clearCounts: true }));
    expect(res.status).toBe(200);
    const sd = txExecutes().find((r) => r.text?.startsWith("DELETE FROM serial_discrepancies"))!;
    expect(sd.text).toBe("DELETE FROM serial_discrepancies WHERE event_id = $1 AND team_id = $2");
  });

  it("still refuses without clearCounts when counts exist", async () => {
    scenario({ countedCount: 1 });
    const res = await assignDELETE(req("DELETE", { eventId: 5, teamId: 7, bins: ["A-01"] }));
    expect(res.status).toBe(409);
    expect(state.mock!.transactionCount()).toBe(0);
  });
});

describe("PATCH /api/admin/assign with clearCounts", () => {
  it("deletes serial discrepancies of the source team before moving the bins", async () => {
    scenario({ countedCount: 3 });
    const res = await assignPATCH(
      req("PATCH", { eventId: 5, fromTeamId: 7, toTeamId: 8, bins: [{ warehouse: "CPT", bin: "A-01" }], clearCounts: true })
    );
    expect(res.status).toBe(200);
    const texts = txExecutes().map((r) => r.text!);
    const sdIdx = texts.findIndex((t) => t.startsWith("DELETE FROM serial_discrepancies"));
    expect(sdIdx).toBeGreaterThan(-1);
    expect(sdIdx).toBeLessThan(texts.findIndex((t) => t.startsWith("UPDATE items")));
  });
});

describe("DELETE /api/admin/teams (supervisor)", () => {
  const del = () => teamsDELETE(req("DELETE", { id: 3, type: "supervisor" }, "http://localhost/api/admin/teams"));

  it("refuses to delete a supervisor whose completed verifications would be lost", async () => {
    scenario({ supervisorHistory: 2 });
    const res = await del();
    expect(res.status).toBe(409);
    expect(state.mock!.transactionCount()).toBe(0);
  });

  it("refuses on a completed event", async () => {
    scenario({ status: "completed" });
    const res = await del();
    expect(res.status).toBe(403);
    expect(state.mock!.transactionCount()).toBe(0);
  });

  it("deletes only pending verifications otherwise", async () => {
    const res = await del();
    expect(res.status).toBe(200);
    const vaDelete = log().find((r) => r.op === "delete" && r.table === "verification_assignments")!;
    expect(sqlText(callArgs(vaDelete, "where")![0])).toContain('"verification_assignments"."status" = $');
  });
});

describe("DELETE /api/admin/events", () => {
  const del = () => eventsDELETE(req("DELETE", { id: 5 }, "http://localhost/api/admin/events"));

  it.each(["completed", "locked"])("refuses a %s event that has counts", async (status) => {
    scenario({ status, eventCounts: 4 });
    const res = await del();
    expect(res.status).toBe(403);
    expect(log().some((r) => r.op === "delete")).toBe(false);
  });

  it("deletes a completed event without counts", async () => {
    scenario({ status: "completed", eventCounts: 0 });
    expect((await del()).status).toBe(200);
  });

  it.each(["setup", "active"])("deletes a %s event", async (status) => {
    scenario({ status, eventCounts: 4 });
    const res = await del();
    expect(res.status).toBe(200);
    expect(log().some((r) => r.op === "delete" && r.table === "stocktake_events")).toBe(true);
  });
});
