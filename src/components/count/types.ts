import type { CountItem } from "@/components/counting/item-card";

export type PageState = "loading" | "bin-selection" | "counting" | "complete" | "reviewing" | "recounting" | "verification-counting" | "serial-verification";

export type BinTab = "not-started" | "in-progress" | "completed" | "verification";

export type BinVariant = "not-started" | "in-progress" | "completed";

export type CompletedFilter = "all" | "variances" | "matched";

export type SearchMode = "contains" | "starts" | "exact" | "bin";

export interface BinStats {
  total: number;
  pending: number;
  counted: number;
  matches: number;
  variances: number;
  supervisorEdited: number;
  serialized: number;
  lineItems: number;
}

export type CountStats = { total: number; counted: number; progressPercent: number };

/** Normalize isMatch which can be boolean (server) or 0/1 (IndexedDB) */
export function isMatchTrue(val: boolean | number | null | undefined): boolean {
  return val === true || val === 1;
}

export interface SerialVerificationTask {
  id: number;
  itemCode: string;
  description: string | null;
  binNumber: string | null;
  unknownSerials: string[];
  verificationAssignedAt: string | null;
}

export type SerialVerificationResult = "confirmed" | "not_found";

export interface VerificationItem {
  verificationId: number;
  countId: number;
  itemId: number;
  itemCode: string;
  description: string | null;
  brand: string | null;
  category: string | null;
  binNumber: string | null;
  warehouse: string | null;
  onHand: number | null;
  avgCost: number | null;
  totalValue: number | null;
  stockStatus: string | null;
  serialNumber: string | null;
  isSerialized: boolean | number | null;
  assignedAt: string;
}

// Verification queue: groups serialized verification items by itemCode
export type VerificationQueueEntry =
  | { type: "single"; item: VerificationItem }
  | { type: "serialized-group"; itemCode: string; description: string | null;
      brand: string | null; stockStatus: string | null; items: VerificationItem[] };

export function naturalCompare(a: string, b: string): number {
  const ax = a.match(/(\d+|\D+)/g) || [];
  const bx = b.match(/(\d+|\D+)/g) || [];
  for (let i = 0; i < Math.max(ax.length, bx.length); i++) {
    if (i >= ax.length) return -1;
    if (i >= bx.length) return 1;
    const an = parseInt(ax[i], 10);
    const bn = parseInt(bx[i], 10);
    if (!isNaN(an) && !isNaN(bn)) {
      if (an !== bn) return an - bn;
    } else {
      const cmp = ax[i].localeCompare(bx[i]);
      if (cmp !== 0) return cmp;
    }
  }
  return 0;
}

// Helper: convert VerificationItem to CountItem for SerializedGroupCard
export function verificationItemToCountItem(vi: VerificationItem): CountItem {
  return {
    id: vi.itemId,
    itemCode: vi.itemCode,
    description: vi.description,
    brand: vi.brand,
    binNumber: vi.binNumber,
    binInternalId: null,
    onHand: vi.onHand,
    avgCost: vi.avgCost,
    stockStatus: vi.stockStatus,
    serialNumber: vi.serialNumber,
    isSerialized: vi.isSerialized,
    countId: null,
    countedQty: null,
    variance: null,
    isMatch: null,
    comment: null,
    checkStatus: null,
    countedAt: null,
  };
}
