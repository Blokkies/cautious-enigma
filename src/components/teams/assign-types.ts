export type BinSortMode = "natural" | "alpha" | "items-desc" | "value-desc";
export type BalanceMode = "equal-bins" | "equal-items";

export function naturalCompare(a: string, b: string): number {
  const re = /(\d+)|(\D+)/g;
  const ax: (string | number)[] = [];
  const bx: (string | number)[] = [];

  let m;
  while ((m = re.exec(a)) !== null) {
    ax.push(m[1] ? parseInt(m[1], 10) : m[2]);
  }
  re.lastIndex = 0;
  while ((m = re.exec(b)) !== null) {
    bx.push(m[1] ? parseInt(m[1], 10) : m[2]);
  }

  const len = Math.min(ax.length, bx.length);
  for (let i = 0; i < len; i++) {
    const ai = ax[i];
    const bi = bx[i];
    if (typeof ai === "number" && typeof bi === "number") {
      if (ai !== bi) return ai - bi;
    } else {
      const cmp = String(ai).localeCompare(String(bi), undefined, { sensitivity: "base" });
      if (cmp !== 0) return cmp;
    }
  }
  return ax.length - bx.length;
}

/**
 * A bin is identified by (warehouse, bin number): "A-01" in JHB and "A-01" in CPT are
 * different bins. This is the shape sent to /api/admin/assign.
 */
export interface BinRef {
  warehouse: string | null;
  bin: string;
}

/** Stable string key for a bin (for Sets / React keys / caches). */
export function binKey(b: { warehouse: string | null; bin_number: string }): string {
  return JSON.stringify([b.warehouse ?? null, b.bin_number]);
}

export function toBinRef(b: { warehouse: string | null; bin_number: string }): BinRef {
  return { warehouse: b.warehouse ?? null, bin: b.bin_number };
}

/** Human-readable bin label, e.g. "A-01 (JHB)". */
export function binRefLabel(ref: BinRef): string {
  return ref.warehouse ? `${ref.bin} (${ref.warehouse})` : ref.bin;
}

export interface BinInfo {
  /** Warehouse of the bin (null for legacy items imported without one). */
  warehouse: string | null;
  bin_number: string;
  item_count: number;
  total_value: number;
  /** Only used by the supervisor view (counted badge / filters / re-assign warning). */
  counted_items?: number;
}

export interface TeamDetail {
  id: number;
  name: string;
  members: string | null;
  itemCount: number;
  totalValue: number;
  bins: BinInfo[];
}

export interface BinItem {
  id: number;
  item_code: string;
  description: string;
  brand: string;
  warehouse: string;
  on_hand: number;
  total_value: number;
  stock_status: string;
  serial_number: string;
}
