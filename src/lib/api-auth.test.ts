import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Each db.select(...).from(...).where(...) resolves to the next queued result.
const { selectResults, selectCalls, fromTables } = vi.hoisted(() => ({
  selectResults: [] as unknown[][],
  selectCalls: { count: 0 },
  fromTables: [] as unknown[],
}));

vi.mock("@/lib/db", () => {
  const chain = {
    from: (table: unknown) => {
      fromTables.push(table);
      return chain;
    },
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
  mergeUnknownsIntoApproved,
  pickItemRefs,
  principalExists,
  requireUser,
  resolveEventId,
  warehouseFilter,
  type ApiUser,
  type ItemRef,
} from "./api-auth";
import { admins, executives, supervisors, teams } from "@/lib/db/schema";

beforeEach(() => {
  selectResults.length = 0;
  selectCalls.count = 0;
  fromTables.length = 0;
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

describe("mergeUnknownsIntoApproved", () => {
  it("moves unknowns into approved so a resolved-approved discrepancy keeps its value", () => {
    const merged = mergeUnknownsIntoApproved(JSON.stringify(["U1", "U2"]), JSON.stringify(["A1"]));
    expect(merged).toEqual({ unknownSerials: "[]", approvedSerials: JSON.stringify(["A1", "U1", "U2"]) });
    expect(getCountableDiscrepancySerials({ status: "resolved", ...merged })).toEqual({
      unknowns: [],
      approved: ["A1", "U1", "U2"],
    });
  });

  it("deduplicates serials already approved", () => {
    expect(mergeUnknownsIntoApproved(JSON.stringify(["A1", "U1"]), JSON.stringify(["A1"])).approvedSerials).toBe(
      JSON.stringify(["A1", "U1"])
    );
  });

  it("handles null / malformed input", () => {
    expect(mergeUnknownsIntoApproved(null, null)).toEqual({ unknownSerials: "[]", approvedSerials: "[]" });
    expect(mergeUnknownsIntoApproved(JSON.stringify(["U1"]), "{bad")).toEqual({
      unknownSerials: "[]",
      approvedSerials: JSON.stringify(["U1"]),
    });
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

describe("principalExists", () => {
  it.each([
    ["admin", admins],
    ["executive", executives],
    ["supervisor", supervisors],
    ["auditor", supervisors],
    ["team", teams],
  ] as const)("%s is looked up by primary key in its own table", async (type, table) => {
    selectResults.push([{ id: 7 }]);
    expect(await principalExists({ id: 7, type })).toBe(true);
    expect(fromTables).toEqual([table]);
    expect(selectCalls.count).toBe(1);
  });

  it("is false when the row is gone", async () => {
    selectResults.push([]);
    expect(await principalExists({ id: 7, type: "admin" })).toBe(false);
  });

  it.each([0, -1, Number.NaN, 1.5])("is false without a DB call for invalid id %s", async (id) => {
    expect(await principalExists({ id, type: "admin" })).toBe(false);
    expect(selectCalls.count).toBe(0);
  });
});

describe("requireUser", () => {
  const as = (type: string, extra: Record<string, string> = {}) =>
    req({ ...validHeaders, "x-user-type": type, ...extra });

  it("returns the user when the role is allowed and the principal exists", async () => {
    selectResults.push([{ id: 7 }]);
    const auth = await requireUser(as("supervisor"), { roles: ["supervisor"] });
    expect(auth.response).toBeUndefined();
    expect(auth.user).toEqual({ id: 7, type: "supervisor", name: "Alice", eventId: 3 });
    expect(selectCalls.count).toBe(1);
  });

  it("defaults to 403 for missing identity and does not hit the DB", async () => {
    const auth = await requireUser(req({}), { roles: ["admin"] });
    expect(auth.response?.status).toBe(403);
    expect(await auth.response?.json()).toEqual({ error: "Unauthorized" });
    expect(selectCalls.count).toBe(0);
  });

  it.each([401, 403] as const)("uses status %i for a disallowed role", async (status) => {
    const auth = await requireUser(as("team"), { roles: ["admin", "supervisor"], status });
    expect(auth.response?.status).toBe(status);
    expect(await auth.response?.json()).toEqual({ error: "Unauthorized" });
    expect(selectCalls.count).toBe(0);
  });

  it.each(["auditor", "executive"])("write: rejects read-only role %s with 403", async (type) => {
    const auth = await requireUser(as(type), { roles: ["supervisor", "auditor", "executive"], status: 401, write: true });
    expect(auth.response?.status).toBe(403);
    expect(await auth.response?.json()).toEqual({ error: "Read-only access" });
    expect(selectCalls.count).toBe(0);
  });

  it("write: lets writable roles through", async () => {
    selectResults.push([{ id: 7 }]);
    const auth = await requireUser(as("supervisor"), { roles: ["supervisor", "auditor"], write: true });
    expect(auth.user?.type).toBe("supervisor");
  });

  it("checks the role before the read-only rule", async () => {
    const auth = await requireUser(as("auditor"), { roles: ["supervisor"], status: 401, write: true });
    expect(auth.response?.status).toBe(401);
  });

  it("returns 401 and clears the session cookie when the principal was deleted", async () => {
    selectResults.push([]);
    const auth = await requireUser(as("admin", { "x-event-id": "0" }), { roles: ["admin"] });
    expect(auth.response?.status).toBe(401);
    expect(await auth.response?.json()).toEqual({ error: "Account no longer exists" });
    const cookie = auth.response?.cookies.get("stocktake-token");
    expect(cookie?.value).toBe("");
    expect(cookie?.maxAge).toBe(0);
  });
});

describe("resolveEventId", () => {
  const user = (type: ApiUser["type"], eventId: number): ApiUser => ({ id: 1, type, name: "U", eventId });

  it.each(["team", "supervisor", "auditor"] as const)("%s is pinned to the token event", (type) => {
    expect(resolveEventId(user(type, 3), "99")).toBe(3);
    expect(resolveEventId(user(type, 3), undefined)).toBe(3);
  });

  it.each(["admin", "executive"] as const)("%s picks the requested event", (type) => {
    expect(resolveEventId(user(type, 0), "5")).toBe(5);
    expect(resolveEventId(user(type, 0), 6)).toBe(6);
  });

  it.each(["admin", "executive"] as const)("%s without a usable request gets null (or its token event)", (type) => {
    expect(resolveEventId(user(type, 0), null)).toBeNull();
    expect(resolveEventId(user(type, 0), "")).toBeNull();
    expect(resolveEventId(user(type, 0), "abc")).toBeNull();
    expect(resolveEventId(user(type, 0), "0")).toBeNull();
    expect(resolveEventId(user(type, 4), null)).toBe(4);
  });
});
