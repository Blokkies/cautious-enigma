// Grouping utility for serialized variance items
// Groups items with the same itemCode + binNumber when they are serialized

export interface SerializedGroupRow<T> {
  type: "serialized-group";
  itemCode: string;
  description: string | null;
  binNumber: string | null;
  teamName: string;
  avgCost: number;
  totalOnHand: number;
  totalCounted: number;
  totalVariance: number;
  totalVarianceValue: number;
  foundCount: number;
  notFoundCount: number;
  unknownSerialCount: number;
  countIds: number[];
  items: T[];
}

export interface SingleRow<T> {
  type: "single";
  item: T;
}

export type DisplayRow<T> = SingleRow<T> | SerializedGroupRow<T>;

interface GroupableItem {
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

export function groupSerializedVariances<T extends GroupableItem>(
  items: T[]
): DisplayRow<T>[] {
  // Build groups by itemCode + binNumber for serialized items
  const groupMap = new Map<string, { firstIndex: number; items: T[] }>();
  const groupOrder: string[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const isSerialized =
      item.isSerialized === true ||
      item.isSerialized === 1 ||
      item.isUnknownSerial === true;

    if (!isSerialized) continue;

    const key = `${item.itemCode}::${item.binNumber || ""}`;
    if (!groupMap.has(key)) {
      groupMap.set(key, { firstIndex: i, items: [] });
      groupOrder.push(key);
    }
    groupMap.get(key)!.items.push(item);
  }

  // Build the result array preserving original order
  const result: DisplayRow<T>[] = [];
  const usedGroupKeys = new Set<string>();

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const isSerialized =
      item.isSerialized === true ||
      item.isSerialized === 1 ||
      item.isUnknownSerial === true;

    if (!isSerialized) {
      result.push({ type: "single", item });
      continue;
    }

    const key = `${item.itemCode}::${item.binNumber || ""}`;
    if (usedGroupKeys.has(key)) continue;
    usedGroupKeys.add(key);

    const group = groupMap.get(key)!;

    // Lone serialized item stays as single
    if (group.items.length === 1) {
      result.push({ type: "single", item: group.items[0] });
      continue;
    }

    // Build aggregate stats
    let totalOnHand = 0;
    let totalCounted = 0;
    let totalVariance = 0;
    let totalVarianceValue = 0;
    let foundCount = 0;
    let notFoundCount = 0;
    let unknownSerialCount = 0;
    const countIds: number[] = [];

    for (const gi of group.items) {
      totalOnHand += gi.onHand ?? 0;
      totalCounted += gi.countedQty;
      totalVariance += gi.variance;
      totalVarianceValue += gi.varianceValue;
      countIds.push(gi.countId);

      if ((gi as GroupableItem).isUnknownSerial) {
        unknownSerialCount++;
      } else if (gi.countedQty > 0) {
        foundCount++;
      } else {
        notFoundCount++;
      }
    }

    result.push({
      type: "serialized-group",
      itemCode: group.items[0].itemCode,
      description: group.items[0].description,
      binNumber: group.items[0].binNumber,
      teamName: group.items[0].teamName,
      avgCost: group.items[0].avgCost ?? 0,
      totalOnHand,
      totalCounted,
      totalVariance,
      totalVarianceValue,
      foundCount,
      notFoundCount,
      unknownSerialCount,
      countIds,
      items: group.items,
    });
  }

  return result;
}
