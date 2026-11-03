import { describe, expect, it } from "vitest";
import { distributeVerifications, type DistributableItem } from "./verification-distribution";

const item = (
  countId: number,
  teamId: number | null,
  binNumber: string | null = null,
  itemCode = "A",
  warehouse: string | null = null
): DistributableItem => ({
  countId,
  teamId,
  binNumber,
  itemCode,
  warehouse,
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

  it("keeps a whole bin with one team instead of round-robining its items", () => {
    // Old behaviour split B1 across teams 1 and 2
    const items = [item(1, 9, "B1", "A"), item(2, 9, "B1", "B"), item(3, 9, "B1", "C"), item(4, 9, "B2", "A")];
    const result = distributeVerifications(items, [1, 2]);
    expect(result.get(1)).toEqual([1, 2, 3]);
    expect(result.get(2)).toEqual([4]);
  });

  it("gives each bin to the least-loaded eligible team", () => {
    const items = [
      item(1, 9, "B1"), item(2, 9, "B1"), item(3, 9, "B1"),
      item(4, 9, "B2"),
      item(5, 9, "B3"),
      item(6, 9, "B4"),
      item(7, 9, "B5"),
    ];
    const result = distributeVerifications(items, [1, 2]);
    // B1 (3 items) -> team 1; B2..B4 -> team 2 until it catches up; tie on B5 -> team 1
    expect(result.get(1)).toEqual([1, 2, 3, 7]);
    expect(result.get(2)).toEqual([4, 5, 6]);
  });

  it("treats the same bin number in different warehouses as different bins", () => {
    const items = [item(1, 9, "B1", "A", "WH1"), item(2, 9, "B1", "A", "WH2"), item(3, 9, "B1", "B", "WH1")];
    const result = distributeVerifications(items, [1, 2]);
    expect(result.get(1)).toEqual([1, 3]);
    expect(result.get(2)).toEqual([2]);
  });

  it("avoids every team that counted part of the bin", () => {
    const items = [item(1, 1, "B1"), item(2, 2, "B1"), item(3, 1, "B1")];
    const result = distributeVerifications(items, [1, 2, 3]);
    expect(result.get(3)).toEqual([1, 2, 3]);
    expect(result.get(1)).toEqual([]);
    expect(result.get(2)).toEqual([]);
  });

  it("splits a bin by original counter only when no selected team is free of it", () => {
    const items = [item(1, 1, "B1", "A"), item(2, 2, "B1", "B"), item(3, 1, "B1", "C")];
    const result = distributeVerifications(items, [1, 2]);
    expect(result.get(2)).toEqual([1, 3]);
    expect(result.get(1)).toEqual([2]);
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
