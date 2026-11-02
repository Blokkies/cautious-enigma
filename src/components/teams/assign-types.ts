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

export interface BinInfo {
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
