import { describe, expect, it } from "vitest";
import { groupSerializedVariances, type SerializedGroupRow } from "./variance-grouping";

interface Row {
  itemCode: string;
  binNumber: string | null;
  isSerialized?: boolean | number | null;
  isUnknownSerial?: boolean;
  onHand: number | null;
  countedQty: number;
  variance: number;
  varianceValue: number;
  countId: number;
  description: string | null;
  teamName: string;
  avgCost: number | null;
  serialNumber?: string | null;
}

let nextId = 1;
function row(overrides: Partial<Row> = {}): Row {
  const id = nextId++;
  return {
    itemCode: "ITEM",
    binNumber: "B1",
    isSerialized: false,
    onHand: 1,
    countedQty: 1,
    variance: 0,
    varianceValue: 0,
    countId: id,
    description: "Desc",
    teamName: "Team A",
    avgCost: 10,
    serialNumber: null,
    ...overrides,
  };
}

function asGroup<T>(r: unknown): SerializedGroupRow<T> {
  expect((r as { type: string }).type).toBe("serialized-group");
  return r as SerializedGroupRow<T>;
}

describe("groupSerializedVariances", () => {
  it("returns an empty array for no items", () => {
    expect(groupSerializedVariances([])).toEqual([]);
  });

  it("passes non-serialized items through as singles in original order", () => {
    const a = row({ itemCode: "A" });
    const b = row({ itemCode: "A" }); // same code+bin but not serialized: not grouped
    const c = row({ itemCode: "C" });
    const result = groupSerializedVariances([a, b, c]);
    expect(result).toEqual([
      { type: "single", item: a },
      { type: "single", item: b },
      { type: "single", item: c },
    ]);
  });

  it("keeps a lone serialized item as a single row", () => {
    const a = row({ isSerialized: true, serialNumber: "S1" });
    expect(groupSerializedVariances([a])).toEqual([{ type: "single", item: a }]);
  });

  it("groups serialized items with the same itemCode + binNumber", () => {
    const a = row({ isSerialized: true, serialNumber: "S1" });
    const b = row({ isSerialized: true, serialNumber: "S2" });
    const result = groupSerializedVariances([a, b]);
    expect(result).toHaveLength(1);
    const g = asGroup<Row>(result[0]);
    expect(g.items).toEqual([a, b]);
    expect(g.countIds).toEqual([a.countId, b.countId]);
  });

  it("treats isSerialized === 1 (sqlite-style flag) as serialized", () => {
    const a = row({ isSerialized: 1 });
    const b = row({ isSerialized: 1 });
    expect(groupSerializedVariances([a, b])[0].type).toBe("serialized-group");
  });

  it("treats isUnknownSerial items as serialized even when isSerialized is false", () => {
    const a = row({ isSerialized: false, isUnknownSerial: true });
    const b = row({ isSerialized: false, isUnknownSerial: true });
    expect(groupSerializedVariances([a, b])[0].type).toBe("serialized-group");
  });

  it("does not treat truthy non-1 values (e.g. 2, null) as serialized", () => {
    const a = row({ isSerialized: 2 as unknown as number });
    const b = row({ isSerialized: 2 as unknown as number });
    const c = row({ isSerialized: null });
    const result = groupSerializedVariances([a, b, c]);
    expect(result.map((r) => r.type)).toEqual(["single", "single", "single"]);
  });

  it("separates groups by bin and by item code", () => {
    const a1 = row({ itemCode: "A", binNumber: "B1", isSerialized: true });
    const a2 = row({ itemCode: "A", binNumber: "B2", isSerialized: true });
    const a3 = row({ itemCode: "A", binNumber: "B1", isSerialized: true });
    const x1 = row({ itemCode: "X", binNumber: "B1", isSerialized: true });
    const result = groupSerializedVariances([a1, a2, a3, x1]);
    expect(result).toHaveLength(3);
    expect(asGroup<Row>(result[0]).items).toEqual([a1, a3]);
    expect(result[1]).toEqual({ type: "single", item: a2 });
    expect(result[2]).toEqual({ type: "single", item: x1 });
  });

  it("treats null and empty-string binNumber as the same bin", () => {
    const a = row({ binNumber: null, isSerialized: true });
    const b = row({ binNumber: "", isSerialized: true });
    const result = groupSerializedVariances([a, b]);
    expect(result).toHaveLength(1);
    const g = asGroup<Row>(result[0]);
    // group header takes the first item's binNumber
    expect(g.binNumber).toBeNull();
  });

  it("places a group at the position of its first member and preserves surrounding order", () => {
    const s1 = row({ itemCode: "S", isSerialized: true });
    const n1 = row({ itemCode: "N1" });
    const s2 = row({ itemCode: "S", isSerialized: true });
    const n2 = row({ itemCode: "N2" });
    const result = groupSerializedVariances([n1, s1, n2, s2]);
    expect(result.map((r) => (r.type === "single" ? r.item.itemCode : `group:${r.itemCode}`))).toEqual([
      "N1",
      "group:S",
      "N2",
    ]);
  });

  it("aggregates totals and found/notFound/unknown counts", () => {
    const found = row({ isSerialized: true, onHand: 1, countedQty: 1, variance: 0, varianceValue: 0 });
    const missing = row({ isSerialized: true, onHand: 1, countedQty: 0, variance: -1, varianceValue: -10 });
    const unknown = row({
      isSerialized: true,
      isUnknownSerial: true,
      onHand: null,
      countedQty: 1,
      variance: 1,
      varianceValue: 10,
    });
    const negativeCount = row({ isSerialized: true, onHand: 1, countedQty: -1, variance: -2, varianceValue: -20 });
    const g = asGroup<Row>(groupSerializedVariances([found, missing, unknown, negativeCount])[0]);
    expect(g.totalOnHand).toBe(3); // null onHand counts as 0
    expect(g.totalCounted).toBe(1);
    expect(g.totalVariance).toBe(-2);
    expect(g.totalVarianceValue).toBe(-20);
    expect(g.foundCount).toBe(1);
    expect(g.notFoundCount).toBe(2); // countedQty <= 0 is "not found"
    expect(g.unknownSerialCount).toBe(1); // unknown wins even though countedQty > 0
  });

  it("takes header fields from the first group member and defaults null avgCost to 0", () => {
    const a = row({ isSerialized: true, description: "First", teamName: "T1", avgCost: null });
    const b = row({ isSerialized: true, description: "Second", teamName: "T2", avgCost: 99 });
    const g = asGroup<Row>(groupSerializedVariances([a, b])[0]);
    expect(g).toMatchObject({
      itemCode: "ITEM",
      description: "First",
      binNumber: "B1",
      teamName: "T1",
      avgCost: 0,
    });
  });

  it("returns the original item objects (no copies)", () => {
    const a = row({ isSerialized: true });
    const b = row({ isSerialized: true });
    const g = asGroup<Row>(groupSerializedVariances([a, b])[0]);
    expect(g.items[0]).toBe(a);
    expect(g.items[1]).toBe(b);
  });

  it("does not mutate the input array", () => {
    const input = [row({ isSerialized: true }), row(), row({ isSerialized: true })];
    const copy = [...input];
    groupSerializedVariances(input);
    expect(input).toEqual(copy);
  });
});
