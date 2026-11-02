// Split selected variance counts across verification teams.
// Shared by the Assign Verification dialog preview and the actual assignment
// so the per-team numbers shown are exactly what gets submitted.

export interface DistributableItem {
  countId: number;
  /** Team that originally counted the item (avoided when possible). */
  teamId: number | null;
  binNumber: string | null;
  itemCode: string | null;
}

/**
 * Sort items by bin (natural order) then item code so adjacent bins stay grouped,
 * then give each item to the least-loaded selected team that did not count it
 * originally (falling back to any selected team when none qualifies). Ties go to
 * the earliest team in `teamIds`.
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

  const sorted = [...items].sort((a, b) => {
    const binCmp = (a.binNumber || "").localeCompare(b.binNumber || "", undefined, { numeric: true, sensitivity: "base" });
    if (binCmp !== 0) return binCmp;
    return (a.itemCode || "").localeCompare(b.itemCode || "", undefined, { numeric: true, sensitivity: "base" });
  });

  for (const item of sorted) {
    const candidates = teamIds.filter((tid) => tid !== item.teamId);
    const pool = candidates.length > 0 ? candidates : teamIds;

    let bestTid = pool[0];
    let bestLoad = chunks.get(bestTid)!.length;
    for (const tid of pool) {
      const load = chunks.get(tid)!.length;
      if (load < bestLoad) {
        bestTid = tid;
        bestLoad = load;
      }
    }
    chunks.get(bestTid)!.push(item.countId);
  }

  return chunks;
}
