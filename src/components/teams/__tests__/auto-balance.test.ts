import { describe, expect, it } from "vitest";
import { planAutoBalance, type BalanceTeam } from "../auto-balance";
import type { BinInfo } from "../assign-types";

const bin = (n: string, items = 1, warehouse: string | null = "JHB"): BinInfo => ({
  warehouse,
  bin_number: n,
  item_count: items,
  total_value: 0,
});
const team = (id: number, currentBins = 0, currentItems = 0): BalanceTeam => ({ id, name: `T${id}`, currentBins, currentItems });

describe("planAutoBalance", () => {
  it("splits bins into contiguous natural-order ranges with equal bin counts", () => {
    const bins = ["A-10", "A-2", "A-1", "A-3", "A-11"].map((n) => bin(n));
    const plan = planAutoBalance(bins, [team(1), team(2)], "equal-bins");
    expect(plan.map((p) => p.bins.map((b) => b.bin))).toEqual([
      ["A-1", "A-2", "A-3"],
      ["A-10", "A-11"],
    ]);
    expect(plan[0]).toMatchObject({ teamId: 1, totalBins: 3, totalItems: 3 });
  });

  it("gives the least-loaded team the first range", () => {
    const plan = planAutoBalance([bin("1"), bin("2")], [team(1, 5, 50), team(2)], "equal-bins");
    expect(plan[0].teamId).toBe(2);
  });

  it("evens out item totals including existing load", () => {
    const bins = [bin("1", 10), bin("2", 10), bin("3", 10), bin("4", 10)];
    const plan = planAutoBalance(bins, [team(1, 1, 20), team(2)], "equal-items");
    expect(Object.fromEntries(plan.map((p) => [p.teamId, p.totalItems]))).toEqual({ 1: 30, 2: 30 });
    expect(plan.reduce((s, p) => s + p.bins.length, 0)).toBe(4);
  });

  it("keeps same-numbered bins in different warehouses apart, in a stable order", () => {
    const plan = planAutoBalance([bin("A", 1, "JHB"), bin("A", 1, "CPT")], [team(1)], "equal-bins");
    expect(plan[0].bins).toEqual([
      { warehouse: "CPT", bin: "A" },
      { warehouse: "JHB", bin: "A" },
    ]);
  });

  it("returns nothing without bins or teams", () => {
    expect(planAutoBalance([], [team(1)], "equal-bins")).toEqual([]);
    expect(planAutoBalance([bin("1")], [], "equal-items")).toEqual([]);
  });
});
