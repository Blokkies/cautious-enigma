import { describe, expect, it, vi } from "vitest";
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

import { ADMIN_HEADERS, hasCall } from "./mock-db";
import { GET as importGET } from "../import/route";

function get(query: string) {
  return importGET(new NextRequest(`http://localhost/api/admin/import${query}`, { headers: ADMIN_HEADERS }));
}

describe("GET /api/admin/import?eventId", () => {
  it("returns the item summary, per-warehouse stats, selection and upload file", async () => {
    state.respond = (rec) => {
      if (rec.table === "admins") return [{ id: 1 }];
      if (rec.table === "stocktake_events") return [{ id: 5, status: "setup", warehouses: JSON.stringify(["JHB"]), uploadId: 9 }];
      if (rec.table === "uploads") return [{ filename: "stock.csv", fileSize: 1234, createdAt: "2026-11-03" }];
      if (rec.table === "items" && hasCall(rec, "groupBy")) {
        return [
          { warehouse: "JHB", itemCount: 3, binCount: 2, totalValue: 30 },
          { warehouse: "CPT", itemCount: 1, binCount: 1, totalValue: 5 },
          { warehouse: "  ", itemCount: 1, binCount: 1, totalValue: 0 },
        ];
      }
      if (rec.table === "items") return [{ count: 4, total: 35 }];
      return [];
    };
    const res = await get("?eventId=5");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("setup");
    expect(body.selectedWarehouses).toEqual(["JHB"]);
    expect(body.upload).toMatchObject({ filename: "stock.csv" });
    expect(body.warehouses.map((w: { warehouse: string }) => w.warehouse)).toEqual(["CPT", "JHB"]);
    expect(body.warehouses[1]).toMatchObject({ itemCount: 3, binCount: 2, totalValue: 30 });
    expect(body.summary).toMatchObject({ totalItems: 4 });
  });

  it("rejects a non-numeric eventId and reports a missing event", async () => {
    state.respond = (rec) => (rec.table === "admins" ? [{ id: 1 }] : []);
    expect((await get("?eventId=abc")).status).toBe(400);
    expect((await get("?eventId=7")).status).toBe(404);
  });

  it("still lists events with items when no eventId is given", async () => {
    state.respond = (rec) => {
      if (rec.table === "admins") return [{ id: 1 }];
      if (rec.table === "stocktake_events") return [{ id: 1, name: "A", status: "setup" }];
      if (rec.table === "items") return [{ count: 2 }];
      return [];
    };
    const body = await (await get("")).json();
    expect(body.events).toEqual([{ id: 1, name: "A", status: "setup", itemCount: 2 }]);
  });
});
