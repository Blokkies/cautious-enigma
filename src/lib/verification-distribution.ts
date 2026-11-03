// Split selected variance counts across verification teams.
// Shared by the Assign Verification dialog preview and the actual assignment
// so the per-team numbers shown are exactly what gets submitted.

export interface DistributableItem {
  countId: number;
  /** Team that originally counted the item (avoided when possible). */
  teamId: number | null;
  binNumber: string | null;
  itemCode: string | null;
  /** Bins are per warehouse: the same bin number in two warehouses is two bins. */
  warehouse?: string | null;
}

const natural = (a: string | null | undefined, b: string | null | undefined) =>
  (a || "").localeCompare(b || "", undefined, { numeric: true, sensitivity: "base" });

/**
 * Sort items by warehouse, bin (natural order) and item code, then hand out
 * whole bins (warehouse + bin) so one team recounts a bin end to end. Each bin
 * goes to the least-loaded selected team (load = items assigned so far) that
 * did not count any item in it originally; ties go to the earliest team in
 * `teamIds`.
 *
 * When every selected team counted something in a bin, the bin is split by
 * original counting team instead, and each part goes to the least-loaded team
 * other than its counter (falling back to any selected team when none
 * qualifies, e.g. only the original team is selected). So an item never goes
 * back to its original team while another team is selected.
 *
 * Returns a map of teamId -> countIds, with an entry (possibly empty) for every
 * team in `teamIds`, in `teamIds` order.
 */
export function distributeVerifications(
  items: readonly DistributableItem[],
  teamIds: readonly number[]
): Map<number, number[]> {
  const chunks = new Map<number, number[]>();
  for (const tid of teamIds) chunks.set(tid, []);
  if (teamIds.length === 0) return chunks;

  const sorted = [...items].sort(
    (a, b) => natural(a.warehouse, b.warehouse) || natural(a.binNumber, b.binNumber) || natural(a.itemCode, b.itemCode)
  );

  // Group consecutive items of the same bin (the sort keeps each bin contiguous;
  // bins compare with the same rules as the sort)
  const sameBin = (a: DistributableItem, b: DistributableItem) =>
    natural(a.warehouse, b.warehouse) === 0 && natural(a.binNumber, b.binNumber) === 0;
  const bins: DistributableItem[][] = [];
  for (const item of sorted) {
    const last = bins[bins.length - 1];
    if (last && sameBin(last[0], item)) last.push(item);
    else bins.push([item]);
  }

  const leastLoaded = (pool: readonly number[]) => {
    let bestTid = pool[0];
    for (const tid of pool) {
      if (chunks.get(tid)!.length < chunks.get(bestTid)!.length) bestTid = tid;
    }
    return bestTid;
  };
  const assign = (group: DistributableItem[], tid: number) => {
    chunks.get(tid)!.push(...group.map((i) => i.countId));
  };

  for (const bin of bins) {
    const counters = new Set(bin.map((i) => i.teamId));
    const eligible = teamIds.filter((tid) => !counters.has(tid));
    if (eligible.length > 0) {
      assign(bin, leastLoaded(eligible));
      continue;
    }

    // No selected team is free of this bin: split it by original counter
    const byCounter = new Map<number | null, DistributableItem[]>();
    for (const item of bin) {
      const part = byCounter.get(item.teamId);
      if (part) part.push(item);
      else byCounter.set(item.teamId, [item]);
    }
    for (const [counter, part] of Array.from(byCounter.entries())) {
      const candidates = teamIds.filter((tid) => tid !== counter);
      assign(part, leastLoaded(candidates.length > 0 ? candidates : teamIds));
    }
  }

  return chunks;
}
