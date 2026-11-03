import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { sql } from "drizzle-orm";
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

import { ADMIN_HEADERS, hasCall, sqlQuery } from "./mock-db";
import { DELETE as assignDELETE, GET as assignGET, PATCH as assignPATCH } from "../assign/route";
import { binNumberExpr, binRefsCondition } from "../assign/bins";
import { NO_BIN, normalizeBin } from "@/lib/no-bin";

const log = () => state.mock!.log;
const txExecutes = () => log().filter((r) => r.op === "execute" && r.inTx);

interface Scenario {
  status?: string; // status seen by the pre-check
  lockedStatus?: string; // status under SELECT ... FOR UPDATE
  warehouses?: string[] | null;
  countedCount?: number;
}

function scenario(s: Scenario = {}) {
  const whJson = s.warehouses ? JSON.stringify(s.warehouses) : null;
  state.respond = (rec) => {
    if (rec.table === "admins") return [{ id: 1 }];
    if (rec.op === "select" && rec.table === "stocktake_events") {
      if (hasCall(rec, "for")) return [{ id: 5, status: s.lockedStatus ?? s.status ?? "active", warehouses: whJson, uploadId: null }];
      if (rec.fields.length === 1 && rec.fields[0] === "warehouses") return [{ warehouses: whJson }];
      return [{ id: 5, status: s.status ?? "active", warehouses: whJson, uploadId: null }];
    }
    if (rec.op === "select" && rec.table === "teams") return [{ id: 7 }, { id: 8 }];
    if (rec.op === "execute" && rec.text?.includes("count(*)::int as cnt")) return [{ cnt: s.countedCount ?? 0 }];
    if (rec.op === "execute" && rec.text?.includes("RETURNING id")) return [{ id: 1 }];
    return [];
  };
}

function req(method: string, body: unknown) {
  return new NextRequest("http://localhost/api/admin/assign", { method, headers: ADMIN_HEADERS, body: JSON.stringify(body) });
}

beforeEach(() => {
  state.mock!.reset();
  scenario();
});

describe("blank bins (bug: unassignable items blocked activation)", () => {
  it("normalizes blank bins to NO_BIN", () => {
    expect(normalizeBin(null)).toBe(NO_BIN);
    expect(normalizeBin("  ")).toBe(NO_BIN);
    expect(normalizeBin(" A-01 ")).toBe("A-01");
  });

  it("GET lists every unassigned item's bin (no bin_number IS NOT NULL filter), blank bins as NO_BIN", async () => {
    const res = await assignGET(new NextRequest("http://localhost/api/admin/assign?eventId=5", { headers: ADMIN_HEADERS }));
    expect(res.status).toBe(200);
    const binQueries = log().filter((r) => r.op === "execute" && r.text?.includes("AS bin_number"));
    expect(binQueries).toHaveLength(3); // unassigned bins + one per team (the mock returns 2 teams)
    for (const q of log().filter((r) => r.op === "execute")) {
      expect(q.text).not.toContain("bin_number IS NOT NULL");
    }
    const unassigned = binQueries.find((r) => r.text?.includes("team_id IS NULL"))!;
    expect(unassigned.text).toContain(`THEN '${NO_BIN}' ELSE bin_number END`);
    expect(unassigned.text).toContain("GROUP BY 1, 2");
    const team = binQueries.find((r) => r.text?.includes("i.team_id = $"))!;
    expect(team.text).toContain(`THEN '${NO_BIN}' ELSE i.bin_number END`);
  });

  it("a NO_BIN ref also matches rows whose bin is still NULL/blank", () => {
    const q = sqlQuery(sql`${binRefsCondition([{ warehouse: "JHB", bin: NO_BIN }], "i")}`);
    expect(q.sql).toBe("((COALESCE(i.warehouse, '') = $1 AND (i.bin_number = $2 OR i.bin_number IS NULL OR trim(i.bin_number) = '')))");
    expect(sqlQuery(sql`${binNumberExpr("i")}`).sql).toBe(
      `(CASE WHEN i.bin_number IS NULL OR trim(i.bin_number) = '' THEN '${NO_BIN}' ELSE i.bin_number END)`
    );
  });
});

describe("DELETE /api/admin/assign bins validation", () => {
  it.each([
    ["missing bins", {}],
    ["empty bins", { bins: [] }],
    ["malformed bins", { bins: "A-01" }],
    ["malformed entry", { bins: [{ warehouse: 3, bin: "A" }] }],
    ["all is not literally true", { all: "yes" }],
  ])("rejects %s with 400 and touches nothing", async (_label, extra) => {
    const res = await assignDELETE(req("DELETE", { eventId: 5, teamId: 7, clearCounts: true, ...extra }));
    expect(res.status).toBe(400);
    expect(state.mock!.transactionCount()).toBe(0);
    expect(log().some((r) => r.op === "execute")).toBe(false);
  });

  it("rejects bins together with all: true", async () => {
    const res = await assignDELETE(req("DELETE", { eventId: 5, teamId: 7, all: true, bins: ["A"] }));
    expect(res.status).toBe(400);
  });

  it("unassigns the whole team only with all: true", async () => {
    const res = await assignDELETE(req("DELETE", { eventId: 5, teamId: 7, all: true }));
    expect(res.status).toBe(200);
    const update = txExecutes().find((r) => r.text?.startsWith("UPDATE items"))!;
    expect(update.text).toBe("UPDATE items SET team_id = NULL WHERE event_id = $1 AND team_id = $2");
  });
});

describe("DELETE/PATCH warehouse scoping (legacy string bins)", () => {
  it("DELETE limits plain bin strings to the event's selected warehouses", async () => {
    scenario({ warehouses: ["JHB"] });
    const res = await assignDELETE(req("DELETE", { eventId: 5, teamId: 7, bins: ["A-01"] }));
    expect(res.status).toBe(200);
    const update = txExecutes().find((r) => r.text?.startsWith("UPDATE items"))!;
    expect(update.text).toContain("(bin_number = $");
    expect(update.text).toContain("warehouse IN ($");
  });

  it("PATCH limits plain bin strings to the event's selected warehouses", async () => {
    scenario({ warehouses: ["JHB", "CPT"] });
    const res = await assignPATCH(req("PATCH", { eventId: 5, fromTeamId: 7, toTeamId: 8, bins: ["A-01"] }));
    expect(res.status).toBe(200);
    const update = txExecutes().find((r) => r.text?.startsWith("UPDATE items"))!;
    expect(update.text).toContain("warehouse IN ($");
    const countCheck = txExecutes().find((r) => r.text?.includes("as cnt"))!;
    expect(countCheck.text).toContain("i.warehouse IN ($");
  });
});

describe("counted-items check runs inside the transaction", () => {
  it("locks the event row and the team's item rows before counting counts", async () => {
    scenario({ countedCount: 0 });
    await assignDELETE(req("DELETE", { eventId: 5, teamId: 7, bins: [{ warehouse: "JHB", bin: "A-01" }] }));
    // No count check outside the transaction
    expect(log().filter((r) => r.op === "execute" && !r.inTx)).toEqual([]);
    const txLog = log().filter((r) => r.inTx);
    const eventLock = txLog.findIndex((r) => r.table === "stocktake_events" && hasCall(r, "for"));
    const itemLock = txLog.findIndex((r) => r.text?.includes("FOR UPDATE"));
    const check = txLog.findIndex((r) => r.text?.includes("as cnt"));
    const update = txLog.findIndex((r) => r.text?.startsWith("UPDATE items"));
    expect(eventLock).toBe(0);
    expect(eventLock).toBeLessThan(itemLock);
    expect(itemLock).toBeLessThan(check);
    expect(check).toBeLessThan(update);
  });

  it("PATCH refuses with 409 (inside the transaction) when counts exist", async () => {
    scenario({ countedCount: 2 });
    const res = await assignPATCH(req("PATCH", { eventId: 5, fromTeamId: 7, toTeamId: 8, bins: [{ warehouse: "JHB", bin: "A" }] }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ hasCountedItems: true, countedCount: 2 });
    expect(txExecutes().some((r) => r.text?.startsWith("UPDATE items"))).toBe(false);
  });

  it("refuses clearCounts with 403 when the event was completed after the pre-check", async () => {
    scenario({ status: "active", lockedStatus: "completed", countedCount: 2 });
    const res = await assignDELETE(req("DELETE", { eventId: 5, teamId: 7, bins: ["A"], clearCounts: true }));
    expect(res.status).toBe(403);
    expect(txExecutes().some((r) => r.text?.startsWith("DELETE"))).toBe(false);
  });
});

describe("clearCounts serial discrepancy scoping", () => {
  it("only deletes discrepancies of the cleared bin+warehouse items, never ambiguous ones", async () => {
    scenario({ countedCount: 1, warehouses: ["JHB", "CPT"] });
    const res = await assignDELETE(
      req("DELETE", { eventId: 5, teamId: 7, bins: [{ warehouse: "JHB", bin: "A-01" }], clearCounts: true })
    );
    expect(res.status).toBe(200);
    const sd = txExecutes().find((r) => r.text?.startsWith("DELETE FROM serial_discrepancies"))!;
    const text = sd.text!;
    // Matches an item being cleared (item code + bin + bin internal id when known) ...
    expect(text).toMatch(/EXISTS \(\s*SELECT 1 FROM items i/);
    expect(text).toContain("i.item_code = sd.item_code");
    expect(text).toContain("sd.bin_internal_id IS NULL OR i.bin_internal_id IS NULL OR i.bin_internal_id = sd.bin_internal_id");
    expect(text).toContain("COALESCE(i.warehouse, '') = $");
    // ... and no item of the team that stays assigned (e.g. same bin number in CPT)
    expect(text).toMatch(/NOT EXISTS \(\s*SELECT 1 FROM items j/);
    expect(text).toContain("COALESCE(j.warehouse, '') = $");
    expect(text).toContain("IS NOT TRUE");
  });
});
