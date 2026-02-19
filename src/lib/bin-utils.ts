/**
 * Aisle/zone prefix extraction and bin grouping utilities.
 */

/**
 * Extract the aisle/zone prefix from a bin code.
 *
 * Strategy:
 * 1. Try explicit separators: "A1.01" → "A1", "01A-02" → "01A"
 * 2. Fallback: alpha→digit or digit→alpha transition: "RACK3B01" → "RACK3"
 * 3. No structure → return the full bin code (degrades to flat list)
 */
export function extractAislePrefix(binCode: string): string {
  // Try splitting on '.' or '-'
  const sepMatch = binCode.match(/^([^.\-]+)[.\-]/);
  if (sepMatch) return sepMatch[1];

  // Fallback: find first alpha↔digit transition after at least 1 char of each type
  // e.g. "RACK3B01" → transition at index 4 (K→3), prefix = "RACK3" (include the digit run)
  // "A1" → "A"
  const transitionMatch = binCode.match(/^([A-Za-z]+\d+|[0-9]+[A-Za-z]+)/);
  if (transitionMatch && transitionMatch[1].length < binCode.length) {
    return transitionMatch[1];
  }

  // No discernible structure
  return binCode;
}

export type BinEntry = [string, { total: number; pending: number; counted: number; matches: number; variances: number; supervisorEdited: number; serialized: number; lineItems: number }];

export interface AisleGroup {
  prefix: string;
  bins: BinEntry[];
}

/**
 * Group sorted bin entries by their aisle prefix, preserving order within groups.
 */
export function groupBinsByAisle(bins: BinEntry[]): AisleGroup[] {
  const groupMap = new Map<string, BinEntry[]>();
  const order: string[] = [];

  for (const entry of bins) {
    const prefix = extractAislePrefix(entry[0]);
    if (!groupMap.has(prefix)) {
      groupMap.set(prefix, []);
      order.push(prefix);
    }
    groupMap.get(prefix)!.push(entry);
  }

  return order.map((prefix) => ({
    prefix,
    bins: groupMap.get(prefix)!,
  }));
}
