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

import { ADMIN_HEADERS, callArgs, hasCall } from "./mock-db";
import { POST as importPOST, PUT as importPUT } from "../import/route";
import { carryOverWarehouseSelection, MAX_REQUEST_SIZE } from "../import/limits";
import { NO_BIN } from "@/lib/no-bin";
import { NO_WAREHOUSE } from "@/lib/excel";

const log = () => state.mock!.log;

interface Scenario {
  /** Stored selection of the target event (JSON). */
  selection?: string[] | null;
  /** Distinct warehouses before (1st list query) and after (2nd) the import. */
  before?: string[];
  after?: string[];
}

function scenario(s: Scenario = {}) {
  let listCalls = 0;
  const sel = s.selection ? JSON.stringify(s.selection) : null;
  state.respond = (rec) => {
    if (rec.table === "admins") return [{ id: 1 }];
    if (rec.op === "select" && rec.table === "stocktake_events") {
      return [{ id: 5, status: "setup", warehouses: sel, uploadId: null }];
    }
    if (rec.op === "select" && rec.table === "counts") return [{ count: 0 }];
    if (rec.op === "select" && rec.table === "items" && rec.fields.includes("warehouse") && hasCall(rec, "groupBy")) {
      const list = listCalls++ === 0 ? (s.before ?? []) : (s.after ?? ["JHB"]);
      return list.map((warehouse) => ({ warehouse }));
    }
    // Copy source items: db.select().from(items)
    if (rec.op === "select" && rec.table === "items" && rec.fields.length === 0) {
      return [
        { itemCode: "A1", binNumber: null, warehouse: null, isSerialized: false },
        { itemCode: "A2", binNumber: "  ", warehouse: "JHB", isSerialized: false },
        { itemCode: "A3", binNumber: "B-01", warehouse: "JHB", isSerialized: false },
      ];
    }
    if (rec.op === "select" && rec.table === "items") return [{ count: 3, total: 0 }];
    if (rec.op === "insert" && rec.table === "uploads") return [{ id: 9 }];
    return [];
  };
}

function xlsxFile(rows: unknown[][]): File {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Sheet1");
  const bytes = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return new File([bytes], "stock.xlsx");
}

function importRequest(file: File, eventId = "5") {
  const form = new FormData();
  form.set("file", file);
  form.set("eventId", eventId);
  const { "content-type": _ct, ...headers } = ADMIN_HEADERS;
  void _ct;
  return importPOST(new NextRequest("http://localhost/api/admin/import", { method: "POST", headers, body: form }));
}

function copyRequest(body: unknown) {
  return importPUT(
    new NextRequest("http://localhost/api/admin/import", { method: "PUT", headers: ADMIN_HEADERS, body: JSON.stringify(body) })
  );
}

const insertedItems = () =>
  log()
    .filter((r) => r.op === "insert" && r.table === "items")
    .flatMap((r) => callArgs(r, "values")![0] as { binNumber: string; warehouse: string }[]);

const savedSelection = () => {
  const update = log().find((r) => r.op === "update" && r.table === "stocktake_events")!;
  return JSON.parse((callArgs(update, "set")![0] as { warehouses: string }).warehouses);
};

beforeEach(() => {
  state.mock!.reset();
  scenario();
});

describe("blank bins are stored as NO_BIN", () => {
  it("on import", async () => {
    const res = await importRequest(
      xlsxFile([
        ["Item", "Bin", "Warehouse"],
        ["A1", "", "JHB"],
        ["A2", "B-01", "JHB"],
      ])
    );
    expect(res.status).toBe(200);
    expect(insertedItems().map((v) => v.binNumber)).toEqual([NO_BIN, "B-01"]);
  });

  it("on copy from another event", async () => {
    const res = await copyRequest({ sourceEventId: 4, targetEventId: 5 });
    expect(res.status).toBe(200);
    expect(insertedItems().map((v) => [v.binNumber, v.warehouse])).toEqual([
      [NO_BIN, NO_WAREHOUSE],
      [NO_BIN, "JHB"],
      ["B-01", "JHB"],
    ]);
  });
});

describe("PUT /api/admin/import (copy) summary", () => {
  it("has the same shape as the POST summary", async () => {
    scenario({ after: ["CPT", "JHB"] });
    const res = await copyRequest({ sourceEventId: 4, targetEventId: 5 });
    const { summary } = await res.json();
    expect(summary).toMatchObject({
      mappedFields: [],
      unmappedHeaders: [],
      warehouses: ["CPT", "JHB"],
      selectedWarehouses: ["CPT", "JHB"],
    });
    expect(typeof summary.totalItems).toBe("number");
    expect(typeof summary.rawRowCount).toBe("number");
  });

  it.each([
    [{ sourceEventId: "abc", targetEventId: 5 }],
    [{ sourceEventId: 4, targetEventId: "5x" }],
    [{ sourceEventId: 4 }],
  ])("rejects non-numeric ids %j with 400", async (body) => {
    expect((await copyRequest(body)).status).toBe(400);
  });
});

describe("warehouse selection survives re-import / copy", () => {
  it("keeps the previously selected warehouses that still exist", async () => {
    scenario({ selection: ["JHB", "DBN"], before: ["CPT", "DBN", "JHB"], after: ["CPT", "JHB", "PE"] });
    const res = await importRequest(xlsxFile([["Item", "Warehouse"], ["A1", "JHB"]]));
    const { summary } = await res.json();
    expect(savedSelection()).toEqual(["JHB"]);
    expect(summary.selectedWarehouses).toEqual(["JHB"]);
    expect(summary.warehouses).toEqual(["CPT", "JHB", "PE"]);
  });

  it("keeps the selection on copy too", async () => {
    scenario({ selection: ["CPT"], before: ["CPT", "JHB"], after: ["CPT", "JHB"] });
    await copyRequest({ sourceEventId: 4, targetEventId: 5 });
    expect(savedSelection()).toEqual(["CPT"]);
  });

  it("selects all warehouses when none of the selection survives", async () => {
    scenario({ selection: ["DBN"], before: ["DBN", "JHB"], after: ["CPT", "JHB"] });
    await importRequest(xlsxFile([["Item"], ["A1"]]));
    expect(savedSelection()).toEqual(["CPT", "JHB"]);
  });

  it("carryOverWarehouseSelection: no selection or everything selected = all (including new ones)", () => {
    expect(carryOverWarehouseSelection(null, [], ["A", "B"])).toEqual(["A", "B"]);
    expect(carryOverWarehouseSelection(["A", "B"], ["A", "B"], ["A", "B", "C"])).toEqual(["A", "B", "C"]);
    expect(carryOverWarehouseSelection(["A"], ["A", "B"], ["A", "B", "C"])).toEqual(["A"]);
    expect(carryOverWarehouseSelection(["X"], ["A", "X"], ["A", "B"])).toEqual(["A", "B"]);
  });
});

describe("POST /api/admin/import body limits", () => {
  it("answers 413 from Content-Length before reading the body", async () => {
    const { "content-type": _ct, ...headers } = ADMIN_HEADERS;
    void _ct;
    const res = await importPOST(
      new NextRequest("http://localhost/api/admin/import", {
        method: "POST",
        headers: { ...headers, "content-type": "multipart/form-data; boundary=x", "content-length": String(MAX_REQUEST_SIZE + 1) },
        body: "--x--",
      })
    );
    expect(res.status).toBe(413);
    expect((await res.json()).error).toMatch(/too large/i);
  });

  it("answers 400 (not 500) for a body that is not valid multipart", async () => {
    const { "content-type": _ct, ...headers } = ADMIN_HEADERS;
    void _ct;
    const res = await importPOST(
      new NextRequest("http://localhost/api/admin/import", {
        method: "POST",
        headers: { ...headers, "content-type": "multipart/form-data; boundary=x" },
        body: "--x\r\nContent-Disposition: form-data; name=\"file\"; filename=\"a.xlsx\"\r\n\r\ntruncated",
      })
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Could not read the uploaded file/);
  });

  it("answers 400 for a non-numeric eventId", async () => {
    const res = await importRequest(xlsxFile([["Item"], ["A1"]]), "abc");
    expect(res.status).toBe(400);
  });
});
