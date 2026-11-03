// Auto-balance planning for bin assignment. Pure (no React, no fetch) so it can be tested.

import { naturalCompare, toBinRef, type BalanceMode, type BinInfo, type BinRef } from "./assign-types";

export interface BalanceTeam {
  id: number;
  name: string;
  /** Bins the team already has. */
  currentBins: number;
  /** Items the team already has. */
  currentItems: number;
}

export interface BalancePlanEntry {
  teamId: number;
  name: string;
  /** Bins added by this plan. */
  bins: BinRef[];
  /** Bins after the plan. */
  totalBins: number;
  /** Items after the plan. */
  totalItems: number;
}

/** Tie-break bins with the same number by warehouse so the order is stable. */
function byWarehouse(a: BinInfo, b: BinInfo): number {
  return (a.warehouse ?? "").localeCompare(b.warehouse ?? "");
}

/**
 * Split `bins` into contiguous ranges (natural bin order, so adjacent bins stay together)
 * across `teams`, least-loaded teams first. "equal-bins" evens out bin counts (new bins
 * only); "equal-items" aims for the same total item count per team, existing load included.
 * Returns only teams that receive bins.
 */
export function planAutoBalance(bins: BinInfo[], teams: BalanceTeam[], mode: BalanceMode): BalancePlanEntry[] {
  if (bins.length === 0 || teams.length === 0) return [];
  const sorted = [...bins].sort((a, b) => naturalCompare(a.bin_number, b.bin_number) || byWarehouse(a, b));

  const trackers = teams.map((t) => ({
    teamId: t.id,
    name: t.name,
    currentBins: t.currentBins,
    currentItems: t.currentItems,
    addedItems: 0,
    bins: [] as BinRef[],
  }));
  if (mode === "equal-bins") trackers.sort((a, b) => a.currentBins - b.currentBins);
  else trackers.sort((a, b) => a.currentItems - b.currentItems);

  if (mode === "equal-bins") {
    let idx = 0;
    for (let t = 0; t < trackers.length; t++) {
      const chunkSize = Math.ceil((sorted.length - idx) / (trackers.length - t));
      for (let j = 0; j < chunkSize && idx < sorted.length; j++, idx++) {
        trackers[t].bins.push(toBinRef(sorted[idx]));
        trackers[t].addedItems += sorted[idx].item_count;
      }
    }
  } else {
    const totalNew = sorted.reduce((s, b) => s + b.item_count, 0);
    const totalExisting = trackers.reduce((s, t) => s + t.currentItems, 0);
    const target = (totalNew + totalExisting) / trackers.length;
    let idx = 0;
    for (let t = 0; t < trackers.length; t++) {
      const isLast = t === trackers.length - 1;
      let running = trackers[t].currentItems;
      while (idx < sorted.length) {
        if (!isLast && running >= target && trackers[t].bins.length > 0) break;
        trackers[t].bins.push(toBinRef(sorted[idx]));
        running += sorted[idx].item_count;
        trackers[t].addedItems += sorted[idx].item_count;
        idx++;
      }
    }
  }

  return trackers
    .filter((t) => t.bins.length > 0)
    .map((t) => ({
      teamId: t.teamId,
      name: t.name,
      bins: t.bins,
      totalBins: t.currentBins + t.bins.length,
      totalItems: t.currentItems + t.addedItems,
    }));
}
