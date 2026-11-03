import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import * as XLSX from "xlsx";
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
import { POST as importPOST, PUT as importPUT } from "../import/route";
import { GET as activateGET, POST as activatePOST } from "../activate/route";
import { activationBlocker } from "../readiness";
import { NO_WAREHOUSE } from "@/lib/excel";

const log = () => state.mock!.log;

function xlsxFile(rows: unknown[][], name = "stock.xlsx"): File {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Sheet1");
  const bytes = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return new File([bytes], name);
}

function importRequest(file: File, eventId = 5) {
  const form = new FormData();
  form.set("file", file);
  form.set("eventId", String(eventId));
  const { "content-type": _ct, ...headers } = ADMIN_HEADERS;
  void _ct;
  return importPOST(new NextRequest("http://localhost/api/admin/import", { method: "POST", headers, body: form }));
}

function jsonRequest(method: string, body: unknown, url = "http://localhost/api/admin/activate") {
  return new NextRequest(url, { method, headers: ADMIN_HEADERS, body: JSON.stringify(body) });
}

const whereText = (rec: QueryRecord) => sqlText(callArgs(rec, "where")?.[0]);

interface Scenario {
  preStatus?: string; // status seen by the pre-check outside the transaction
  lockedStatus?: string; // status seen under SELECT ... FOR UPDATE
  oldUploadId?: number | null;
  warehouses?: string | null;
  itemCount?: number;
  teamCount?: number;
  unassignedCount?: number;
  activateUpdates?: number; // rows changed by the conditional activate UPDATE
}

function scenario(s: Scenario = {}) {
  state.respond = (rec) => {
    if (rec.table === "admins") return [{ id: 1 }];
    if (rec.op === "select" && rec.table === "stocktake_events") {
      if (hasCall(rec, "for")) {
        return s.lockedStatus === undefined && s.preStatus === undefined
          ? [{ id: 5, status: "setup", warehouses: s.warehouses ?? null, uploadId: s.oldUploadId ?? null }]
          : [{ id: 5, status: s.lockedStatus ?? "setup", warehouses: s.warehouses ?? null, uploadId: s.oldUploadId ?? null }];
      }
      if (rec.fields.includes("warehouses") && rec.fields.length === 1) return [{ warehouses: s.warehouses ?? null }];
      return [{ id: 5, status: s.preStatus ?? "setup", uploadId: s.oldUploadId ?? null, warehouses: s.warehouses ?? null }];
    }
    if (rec.op === "select" && rec.table === "counts") return [{ count: 0 }];
    if (rec.op === "select" && rec.table === "teams") return [{ count: s.teamCount ?? 1 }];
    if (rec.op === "select" && rec.table === "supervisors") return [{ count: 1 }];
    if (rec.op === "select" && rec.table === "items" && rec.fields.includes("count")) {
      return whereText(rec).includes('"team_id" is null')
        ? [{ count: s.unassignedCount ?? 0 }]
        : [{ count: s.itemCount ?? 10 }];
    }
    if (rec.op === "select" && rec.table === "items" && rec.fields.includes("warehouse")) {
      return [{ warehouse: NO_WAREHOUSE }, { warehouse: "JHB" }];
    }
    if (rec.op === "insert" && rec.table === "uploads") return [{ id: 9 }];
    if (rec.op === "update" && rec.table === "stocktake_events" && hasCall(rec, "returning")) {
      return Array.from({ length: s.activateUpdates ?? 1 }, () => ({ id: 5 }));
    }
    return [];
  };
}

beforeEach(() => {
  state.mock!.reset();
  scenario();
});

describe("POST /api/admin/import", () => {
  it("stores a blank warehouse as '(No warehouse)' and lists it in the event warehouses", async () => {
    const res = await importRequest(
      xlsxFile([
        ["Item", "Warehouse", "Bin", "Qty"],
        ["A1", "", "B-01", 1],
        ["A2", "  ", "B-02", 1],
        ["A3", "JHB", "B-03", 1],
      ])
    );
    expect(res.status).toBe(200);
    const insert = log().find((r) => r.op === "insert" && r.table === "items")!;
    const values = callArgs(insert, "values")![0] as { warehouse: string }[];
    expect(values.map((v) => v.warehouse)).toEqual([NO_WAREHOUSE, NO_WAREHOUSE, "JHB"]);
    const body = await res.json();
    expect(body.summary.warehouses).toEqual([NO_WAREHOUSE, "JHB"]);
  });

  it("imports serial numbers even when the first row's serial is blank", async () => {
    await importRequest(
      xlsxFile([
        ["Item", "Serial Number"],
        ["A1", ""],
        ["A2", "SN-2"],
      ])
    );
    const insert = log().find((r) => r.op === "insert" && r.table === "items")!;
    const values = callArgs(insert, "values")![0] as { serialNumber: string | null; isSerialized: boolean }[];
    expect(values.map((v) => [v.serialNumber, v.isSerialized])).toEqual([[null, false], ["SN-2", true]]);
  });

  it("re-checks the status under a row lock and aborts if the event was activated meanwhile", async () => {
    scenario({ preStatus: "setup", lockedStatus: "active" });
    const res = await importRequest(xlsxFile([["Item"], ["A1"]]));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/no longer in setup/);
    const lock = log().find((r) => r.inTx && r.table === "stocktake_events" && hasCall(r, "for"));
    expect(callArgs(lock!, "for")).toEqual(["update"]);
    // Nothing was deleted or inserted
    expect(log().filter((r) => r.inTx && (r.op === "delete" || r.op === "insert"))).toEqual([]);
  });

  it("deletes the replaced upload (if no other event links to it) inside the transaction", async () => {
    scenario({ oldUploadId: 3 });
    const res = await importRequest(xlsxFile([["Item"], ["A1"]]));
    expect(res.status).toBe(200);
    const uploadDeletes = log().filter((r) => r.op === "delete" && r.table === "uploads");
    expect(uploadDeletes).toHaveLength(1);
    expect(uploadDeletes[0].inTx).toBe(true);
    // ... guarded by a NOT EXISTS subquery on events still linking to the old upload
    const sub = log().find(
      (r) => r.inTx && r.op === "select" && r.table === "stocktake_events" && !hasCall(r, "for")
    )!;
    expect(whereText(sub)).toContain('"stocktake_events"."upload_id" =');
    // and it runs after the event was pointed at the new upload
    const relink = log().findIndex((r) => r.op === "update" && r.table === "stocktake_events");
    expect(relink).toBeGreaterThan(-1);
    expect(relink).toBeLessThan(log().indexOf(uploadDeletes[0]));
  });

  it("does not delete anything from uploads on a first import", async () => {
    scenario({ oldUploadId: null });
    await importRequest(xlsxFile([["Item"], ["A1"]]));
    expect(log().filter((r) => r.op === "delete" && r.table === "uploads")).toEqual([]);
  });
});

describe("PUT /api/admin/import (copy)", () => {
  it("aborts with 409 when the target was activated after the pre-check", async () => {
    scenario({ preStatus: "setup", lockedStatus: "active" });
    const inner = state.respond;
    // db.select().from(items): the source event's items
    state.respond = (rec) =>
      rec.op === "select" && rec.table === "items" && rec.fields.length === 0 ? [{ itemCode: "A1", warehouse: null }] : inner(rec);
    const res = await importPUT(jsonRequest("PUT", { sourceEventId: 4, targetEventId: 5 }, "http://localhost/api/admin/import"));
    expect(res.status).toBe(409);
    expect(log().filter((r) => r.inTx && (r.op === "delete" || r.op === "insert"))).toEqual([]);
  });
});

describe("POST /api/admin/activate", () => {
  const activate = () => activatePOST(jsonRequest("POST", { eventId: 5 }));

  it("activates a ready event with a conditional UPDATE ... WHERE status = 'setup'", async () => {
    const res = await activate();
    expect(res.status).toBe(200);
    const update = log().find((r) => r.op === "update" && r.table === "stocktake_events")!;
    expect(update.inTx).toBe(true);
    expect(sqlText(callArgs(update, "where")![0])).toContain('"stocktake_events"."status" = $');
  });

  it("returns 409 when the conditional update changes no rows", async () => {
    scenario({ activateUpdates: 0 });
    const res = await activate();
    expect(res.status).toBe(409);
  });

  it("returns 409 when the locked event is no longer in setup", async () => {
    scenario({ lockedStatus: "active" });
    const res = await activate();
    expect(res.status).toBe(409);
    expect(log().some((r) => r.op === "update")).toBe(false);
  });

  it.each([
    [{ itemCount: 0 }, /no items/],
    [{ teamCount: 0 }, /no counting teams/],
    [{ unassignedCount: 3 }, /3 items are not assigned/],
  ] as const)("rejects %j with 400 and a clear message", async (s, message) => {
    scenario(s);
    const res = await activate();
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(message);
    expect(log().some((r) => r.op === "update")).toBe(false);
  });

  it("scopes the readiness counts to the event's warehouses", async () => {
    scenario({ warehouses: JSON.stringify(["JHB"]) });
    await activate();
    const itemCounts = log().filter((r) => r.op === "select" && r.table === "items");
    expect(itemCounts).toHaveLength(2);
    for (const rec of itemCounts) expect(whereText(rec)).toContain('"items"."warehouse" in');
  });
});

describe("GET /api/admin/activate", () => {
  it("reports unassigned items within the event warehouse scope plus the activation blocker", async () => {
    scenario({ warehouses: JSON.stringify(["JHB"]), unassignedCount: 2 });
    const res = await activateGET(
      new NextRequest("http://localhost/api/admin/activate?eventId=5", { headers: ADMIN_HEADERS })
    );
    const body = await res.json();
    expect(body).toMatchObject({ unassignedCount: 2, allItemsAssigned: false });
    expect(body.blocker).toMatch(/2 items are not assigned/);
    const unassigned = log().find((r) => r.table === "items" && whereText(r).includes('"team_id" is null'))!;
    expect(whereText(unassigned)).toContain('"items"."warehouse" in');
  });
});

describe("activationBlocker", () => {
  it("is null for a ready event and names the first problem otherwise", () => {
    expect(activationBlocker({ itemCount: 5, teamCount: 1, supervisorCount: 1, unassignedCount: 0 })).toBeNull();
    expect(activationBlocker({ itemCount: 0, teamCount: 0, supervisorCount: 0, unassignedCount: 0 })).toMatch(/no items/);
    expect(activationBlocker({ itemCount: 5, teamCount: 0, supervisorCount: 1, unassignedCount: 5 })).toMatch(/no counting teams/);
    expect(activationBlocker({ itemCount: 5, teamCount: 1, supervisorCount: 0, unassignedCount: 0 })).toMatch(/no supervisors/);
    expect(activationBlocker({ itemCount: 5, teamCount: 1, supervisorCount: 1, unassignedCount: 1 })).toMatch(/1 item is not assigned/);
  });
});
