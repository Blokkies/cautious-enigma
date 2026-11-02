import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Each db.select(...).from(...).where(...) resolves to the next queued result.
const { selectResults, selectCalls } = vi.hoisted(() => ({
  selectResults: [] as unknown[][],
  selectCalls: { count: 0 },
}));

vi.mock("@/lib/db", () => {
  const chain = {
    from: () => chain,
    where: () => {
      selectCalls.count++;
      return Promise.resolve(selectResults.shift() ?? []);
    },
  };
  return { db: { select: () => chain } };
});

import {
  buildItemRefMap,
  checkEventActive,
  countsWarehouseFilter,
  getApiUser,
  getCountableDiscrepancySerials,
  getEventWarehouses,
  getSerialDiscrepancyOverStats,
  isRefOutsideWarehouses,
  pickItemRefs,
  warehouseFilter,
  type ItemRef,
} from "./api-auth";

beforeEach(() => {
  selectResults.length = 0;
  selectCalls.count = 0;
});

function req(headers: Record<string, string>) {
  return new NextRequest("http://localhost/api/test", { headers });
}

const validHeaders = {
  "x-user-id": "7",
  "x-user-type": "supervisor",
  "x-user-name": "Alice",
  "x-event-id": "3",
};

describe("getApiUser", () => {
  it("parses a complete set of headers", () => {
    expect(getApiUser(req(validHeaders))).toEqual({
      id: 7,
      type: "supervisor",
      name: "Alice",
      eventId: 3,
    });
  });

  it.each(["x-user-id", "x-user-type", "x-user-name", "x-event-id"])("returns null when %s is missing", (h) => {
    const headers: Record<string, string> = { ...validHeaders };
    delete headers[h];
    expect(getApiUser(req(headers))).toBeNull();
  });

  it("returns null when a header is empty", () => {
    expect(getApiUser(req({ ...validHeaders, "x-user-name": "" }))).toBeNull();
  });

  it.each(["team", "supervisor", "admin", "auditor", "executive"])("accepts user type %s", (type) => {
    expect(getApiUser(req({ ...validHeaders, "x-user-type": type }))?.type).toBe(type);
  });

  it("rejects unknown user types (case-sensitive)", () => {
    expect(getApiUser(req({ ...validHeaders, "x-user-type": "root" }))).toBeNull();
    expect(getApiUser(req({ ...validHeaders, "x-user-type": "Admin" }))).toBeNull();
  });

  it("URI-decodes the user name", () => {
    expect(getApiUser(req({ ...validHeaders, "x-user-name": "Zo%C3%AB" }))?.name).toBe("Zoë");
    expect(getApiUser(req({ ...validHeaders, "x-user-name": "Team%20%E6%9D%B1" }))?.name).toBe("Team 東");
  });

  it("falls back to the raw value when the name is not valid URI encoding", () => {
    expect(getApiUser(req({ ...validHeaders, "x-user-name": "100%" }))?.name).toBe("100%");
    expect(getApiUser(req({ ...validHeaders, "x-user-name": "%E0%A4%A" }))?.name).toBe("%E0%A4%A");
  });

  it("converts numeric headers with Number() (non-numeric becomes NaN)", () => {
    const user = getApiUser(req({ ...validHeaders, "x-user-id": "abc" }));
    expect(user).not.toBeNull();
    expect(user!.id).toBeNaN();
  });
});

describe("warehouseFilter / countsWarehouseFilter", () => {
  it("returns undefined when no warehouse filter is set", () => {
    expect(warehouseFilter(null)).toBeUndefined();
    expect(warehouseFilter([])).toBeUndefined();
    expect(countsWarehouseFilter(1, null)).toBeUndefined();
    expect(countsWarehouseFilter(1, [])).toBeUndefined();
  });

  it("returns a SQL condition when warehouses are selected", () => {
    expect(warehouseFilter(["JHB"])).toBeDefined();
    expect(countsWarehouseFilter(1, ["JHB", "CPT"])).toBeDefined();
  });
});

function ref(itemCode: string, warehouse: string | null, extra: Partial<ItemRef> = {}): ItemRef {
  return {
    itemCode,
    internalId: null,
    warehouse,
    division: null,
    stockStatus: null,
    brand: null,
    category: null,
    avgCost: null,
    ...extra,
  };
}

describe("pickItemRefs", () => {
  it("keeps the first row per itemCode when no warehouse filter is set", () => {
    const a1 = ref("A", "JHB");
    const a2 = ref("A", "CPT");
    const b = ref("B", null);
    const map = pickItemRefs([a1, a2, b], null);
    expect(map.size).toBe(2);
    expect(map.get("A")).toBe(a1);
    expect(map.get("B")).toBe(b);
    expect(pickItemRefs([a1, a2], []).get("A")).toBe(a1);
  });

  it("prefers a later row that is inside the selected warehouses", () => {
    const outside = ref("A", "JHB");
    const inside = ref("A", "CPT");
    expect(pickItemRefs([outside, inside], ["CPT"]).get("A")).toBe(inside);
  });

  it("keeps the first in-warehouse row once one has been chosen", () => {
    const in1 = ref("A", "CPT");
    const in2 = ref("A", "DBN");
    expect(pickItemRefs([in1, in2], ["CPT", "DBN"]).get("A")).toBe(in1);
  });

  it("falls back to the first row when no row is in the selected warehouses", () => {
    const a1 = ref("A", "JHB");
    const a2 = ref("A", null);
    expect(pickItemRefs([a1, a2], ["CPT"]).get("A")).toBe(a1);
  });

  it("replaces a null-warehouse first row with an in-warehouse row", () => {
    const a1 = ref("A", null);
    const a2 = ref("A", "CPT");
    expect(pickItemRefs([a1, a2], ["CPT"]).get("A")).toBe(a2);
  });
});

describe("buildItemRefMap", () => {
  it("returns an empty map without querying when there are no item codes", async () => {
    const map = await buildItemRefMap(1, [], ["CPT"]);
    expect(map.size).toBe(0);
    expect(selectCalls.count).toBe(0);
  });

  it("applies the warehouse preference to queried rows", async () => {
    selectResults.push([ref("A", "JHB", { avgCost: 1 }), ref("A", "CPT", { avgCost: 2 })]);
    const map = await buildItemRefMap(1, ["A", "A"], ["CPT"]);
    expect(map.get("A")?.avgCost).toBe(2);
    expect(selectCalls.count).toBe(1);
  });
});

describe("isRefOutsideWarehouses", () => {
  it("is false when no filter is set", () => {
    expect(isRefOutsideWarehouses({ warehouse: "JHB" }, null)).toBe(false);
    expect(isRefOutsideWarehouses({ warehouse: "JHB" }, [])).toBe(false);
  });

  it("is false when the ref is missing or has no warehouse (unknown items are kept)", () => {
    expect(isRefOutsideWarehouses(undefined, ["CPT"])).toBe(false);
    expect(isRefOutsideWarehouses({ warehouse: null }, ["CPT"])).toBe(false);
  });

  it("is true only when the ref's warehouse is not selected", () => {
    expect(isRefOutsideWarehouses({ warehouse: "JHB" }, ["CPT"])).toBe(true);
    expect(isRefOutsideWarehouses({ warehouse: "CPT" }, ["CPT"])).toBe(false);
  });
});

describe("getCountableDiscrepancySerials", () => {
  const unknownSerials = JSON.stringify(["U1", "U2"]);
  const approvedSerials = JSON.stringify(["A1"]);

  it("counts unknowns and approved for open discrepancies", () => {
    expect(getCountableDiscrepancySerials({ status: "open", unknownSerials, approvedSerials })).toEqual({
      unknowns: ["U1", "U2"],
      approved: ["A1"],
    });
  });

  it("treats null status like open", () => {
    expect(getCountableDiscrepancySerials({ status: null, unknownSerials, approvedSerials: null })).toEqual({
      unknowns: ["U1", "U2"],
      approved: [],
    });
  });

  it("counts only approved serials once resolved", () => {
    expect(getCountableDiscrepancySerials({ status: "resolved", unknownSerials, approvedSerials })).toEqual({
      unknowns: [],
      approved: ["A1"],
    });
  });

  it("still counts unknowns for dismissed discrepancies (only 'resolved' clears them)", () => {
    expect(getCountableDiscrepancySerials({ status: "dismissed", unknownSerials, approvedSerials: null })).toEqual({
      unknowns: ["U1", "U2"],
      approved: [],
    });
  });

  it("tolerates malformed JSON", () => {
    expect(getCountableDiscrepancySerials({ status: "open", unknownSerials: "{bad", approvedSerials: "" })).toEqual({
      unknowns: [],
      approved: [],
    });
  });
});

describe("getSerialDiscrepancyOverStats", () => {
  it("returns zeros without a second query when there are no discrepancies", async () => {
    selectResults.push([]);
    expect(await getSerialDiscrepancyOverStats(1, null)).toEqual({ overCount: 0, overValue: 0 });
    expect(selectCalls.count).toBe(1);
  });

  it("sums countable serials times avgCost, skipping out-of-warehouse items", async () => {
    selectResults.push([
      { itemCode: "A", unknownSerials: '["u1","u2"]', approvedSerials: '["a1"]', status: "open" },
      { itemCode: "B", unknownSerials: '["u1"]', approvedSerials: '["a1","a2"]', status: "resolved" },
      { itemCode: "C", unknownSerials: '["u1"]', approvedSerials: null, status: "open" }, // outside
      { itemCode: "D", unknownSerials: '["u1"]', approvedSerials: null, status: "open" }, // no ref → cost 0
    ]);
    selectResults.push([
      ref("A", "CPT", { avgCost: 10 }),
      ref("B", "CPT", { avgCost: 5 }),
      ref("C", "JHB", { avgCost: 1000 }),
    ]);
    expect(await getSerialDiscrepancyOverStats(1, ["CPT"])).toEqual({
      overCount: 3 + 2 + 1,
      overValue: 30 + 10 + 0,
    });
  });
});

describe("checkEventActive", () => {
  it.each([
    [[], "Event not found"],
    [[{ status: "setup" }], "This stocktake has not been activated yet."],
    [[{ status: "active" }], null],
    [[{ status: "completed" }], "This stocktake has been completed. No further changes are allowed."],
    [[{ status: "locked" }], "This stocktake has been completed. No further changes are allowed."],
  ])("rows %j → %s", async (rows, expected) => {
    selectResults.push(rows);
    expect(await checkEventActive(1)).toBe(expected);
  });
});

describe("getEventWarehouses", () => {
  it.each([
    [[], null],
    [[{ warehouses: null }], null],
    [[{ warehouses: "" }], null],
    [[{ warehouses: "[]" }], null],
    [[{ warehouses: "not json" }], null],
    [[{ warehouses: '["CPT","JHB"]' }], ["CPT", "JHB"]],
  ])("rows %j → %j", async (rows, expected) => {
    selectResults.push(rows);
    expect(await getEventWarehouses(1)).toEqual(expected);
  });
});
