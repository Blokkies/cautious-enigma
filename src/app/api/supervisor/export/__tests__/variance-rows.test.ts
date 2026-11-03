import { describe, expect, it, vi } from "vitest";
import type { ItemRef } from "@/lib/api-auth";

// The helpers are pure; stub the db module so importing api-auth needs no DATABASE_URL.
vi.mock("@/lib/db", () => ({ db: {} }));
import {
  buildDiscrepancyRows,
  countUnreviewedDiscrepancySerials,
  isNetsuiteAdjustmentType,
  mergeSerializedUpRows,
  netsuiteDiscrepancySerials,
  type DiscrepancyExportRow,
} from "../variance-rows";

const ref: ItemRef = {
  itemCode: "PHONE",
  internalId: "101",
  warehouse: "JHB",
  division: "Mobile",
  stockStatus: "Good",
  brand: "Acme",
  category: "Phones",
  avgCost: 500,
};
const refMap = new Map([["PHONE", ref]]);

function disc(overrides: Partial<DiscrepancyExportRow>): DiscrepancyExportRow {
  return {
    itemCode: "PHONE",
    description: "Phone",
    binNumber: "B1",
    binInternalId: "9",
    unknownSerials: "[]",
    approvedSerials: null,
    status: "open",
    resolutionType: null,
    teamName: "Team A",
    ...overrides,
  };
}

const openDisc = disc({ unknownSerials: JSON.stringify(["U1", "U2"]), approvedSerials: JSON.stringify(["A0"]) });
const resolvedDisc = disc({
  status: "resolved",
  resolutionType: "approved",
  unknownSerials: JSON.stringify(["LEFTOVER"]),
  approvedSerials: JSON.stringify(["A1", "A2"]),
});
const dismissedDisc = disc({ status: "resolved", resolutionType: "dismissed", unknownSerials: JSON.stringify(["D1"]) });

describe("isNetsuiteAdjustmentType", () => {
  it("covers exactly the four adjustment files", () => {
    for (const t of ["variances_nonserialized_up", "variances_nonserialized_down", "variances_serialized_up", "variances_serialized_down"]) {
      expect(isNetsuiteAdjustmentType(t)).toBe(true);
    }
    for (const t of ["variances", "variances_all", "full", "serials"]) {
      expect(isNetsuiteAdjustmentType(t)).toBe(false);
    }
  });
});

describe("netsuiteDiscrepancySerials", () => {
  it("includes only approved serials of resolved discrepancies", () => {
    expect(netsuiteDiscrepancySerials(resolvedDisc)).toEqual({ included: ["A1", "A2"], unreviewed: 0 });
  });

  it("holds back every serial of an open discrepancy as unreviewed", () => {
    expect(netsuiteDiscrepancySerials(openDisc)).toEqual({ included: [], unreviewed: 3 });
  });

  it("a dismissed discrepancy contributes nothing and is not unreviewed", () => {
    expect(netsuiteDiscrepancySerials(dismissedDisc)).toEqual({ included: [], unreviewed: 0 });
  });
});

describe("buildDiscrepancyRows", () => {
  const all = [openDisc, resolvedDisc, dismissedDisc];

  it("netsuite audience: only approved serials of resolved discrepancies, all accepted", () => {
    const rows = buildDiscrepancyRows(all, refMap, null, "netsuite");
    expect(rows.map((r) => r["Serial Number"])).toEqual(["A1", "A2"]);
    expect(rows.every((r) => r["Check Status"] === "accepted")).toBe(true);
    expect(rows[0]).toMatchObject({ "Item Internal ID": "101", "Warehouse": "JHB", "Variance": 1, "Variance Value": 500 });
  });

  it("review audience keeps open unknowns (pending) and approved serials", () => {
    const rows = buildDiscrepancyRows(all, refMap, null, "review");
    expect(rows.map((r) => [r["Serial Number"], r["Check Status"]])).toEqual([
      ["U1", "pending"],
      ["U2", "pending"],
      ["A0", "accepted"],
      ["A1", "accepted"],
      ["A2", "accepted"],
    ]);
  });

  it("skips discrepancies whose item lies outside the selected warehouses", () => {
    expect(buildDiscrepancyRows(all, refMap, ["CPT"], "netsuite")).toEqual([]);
    expect(countUnreviewedDiscrepancySerials(all, refMap, ["CPT"])).toBe(0);
  });

  it("counts unreviewed serials across discrepancies", () => {
    expect(countUnreviewedDiscrepancySerials(all, refMap, null)).toBe(3);
  });
});

describe("mergeSerializedUpRows", () => {
  const overCount = {
    "Item Code": "PHONE",
    "Serial Number": "A1",
    "On Hand": 1,
    "Counted Qty": 2,
    "Variance": 1,
    "Check Status": "accepted",
  };

  it("includes accepted serialized over-counts alongside discrepancy serials", () => {
    const other = { ...overCount, "Serial Number": "S9" };
    const discRows = buildDiscrepancyRows([resolvedDisc], refMap, null, "netsuite");
    const merged = mergeSerializedUpRows([other], discRows);
    expect(merged.map((r) => r["Serial Number"])).toEqual(["S9", "A1", "A2"]);
  });

  it("does not adjust the same serial twice when it is also an approved discrepancy serial", () => {
    const discRows = buildDiscrepancyRows([resolvedDisc], refMap, null, "netsuite");
    const merged = mergeSerializedUpRows([overCount], discRows);
    expect(merged.map((r) => r["Serial Number"])).toEqual(["A1", "A2"]);
    expect(merged[0]).toBe(overCount);
  });

  it("dedupes case-insensitively and across discrepancies", () => {
    const twice = [
      disc({ status: "resolved", approvedSerials: JSON.stringify(["x1"]) }),
      disc({ status: "resolved", approvedSerials: JSON.stringify(["X1"]), teamName: "Team B" }),
    ];
    const merged = mergeSerializedUpRows([], buildDiscrepancyRows(twice, refMap, null, "netsuite"));
    expect(merged).toHaveLength(1);
  });

  it("keeps the same serial number under different item codes", () => {
    const merged = mergeSerializedUpRows([overCount], [{ ...overCount, "Item Code": "TABLET" }]);
    expect(merged).toHaveLength(2);
  });
});
