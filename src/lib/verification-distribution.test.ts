import { describe, expect, it } from "vitest";
import { distributeVerifications, type DistributableItem } from "./verification-distribution";

const item = (countId: number, teamId: number | null, binNumber: string | null = null, itemCode = "A"): DistributableItem => ({
  countId,
  teamId,
  binNumber,
  itemCode,
});

describe("distributeVerifications", () => {
  it("returns an empty entry for every selected team, in order", () => {
    const result = distributeVerifications([], [3, 1, 2]);
    expect(Array.from(result.keys())).toEqual([3, 1, 2]);
    expect(Array.from(result.values())).toEqual([[], [], []]);
  });

  it("returns an empty map with no teams", () => {
    expect(distributeVerifications([item(1, 1)], []).size).toBe(0);
  });

  it("never gives an item back to the team that counted it when another team is selected", () => {
    // All items counted by team 1: an even round-robin would give team 1 half of them
    const items = [1, 2, 3, 4].map((id) => item(id, 1, `B${id}`));
    const result = distributeVerifications(items, [1, 2]);
    expect(result.get(1)).toEqual([]);
    expect(result.get(2)).toEqual([1, 2, 3, 4]);
  });

  it("falls back to the original team when it is the only one selected", () => {
    const result = distributeVerifications([item(1, 7), item(2, 7)], [7]);
    expect(result.get(7)).toEqual([1, 2]);
  });

  it("balances load between eligible teams", () => {
    const items = [1, 2, 3, 4, 5, 6].map((id) => item(id, 9, `B${id}`));
    const result = distributeVerifications(items, [1, 2, 3]);
    expect(result.get(1)).toEqual([1, 4]);
    expect(result.get(2)).toEqual([2, 5]);
    expect(result.get(3)).toEqual([3, 6]);
  });

  it("sorts by bin in natural order, then item code", () => {
    const items = [item(1, null, "B10", "X"), item(2, null, "B2", "Z"), item(3, null, "B2", "Y")];
    const result = distributeVerifications(items, [5]);
    expect(result.get(5)).toEqual([3, 2, 1]);
  });

  it("assigns every item exactly once", () => {
    const items = Array.from({ length: 25 }, (_, i) => item(i + 1, (i % 3) + 1, `B${i % 7}`));
    const result = distributeVerifications(items, [1, 2, 3]);
    const all = Array.from(result.values()).flat().sort((a, b) => a - b);
    expect(all).toEqual(items.map((i) => i.countId));
    for (const [tid, ids] of result) {
      for (const id of ids) expect(items[id - 1].teamId).not.toBe(tid);
    }
  });
});
