export interface VarianceItem {
  countId: number;
  itemCode: string;
  description: string | null;
  brand: string | null;
  binNumber: string | null;
  warehouse?: string | null;
  onHand: number | null;
  avgCost: number | null;
  countedQty: number;
  variance: number;
  varianceValue: number;
  teamId: number;
  teamName: string;
  comment: string | null;
  checkStatus: string;
  countedAt: string;
  // Verification fields
  verificationId?: number;
  verificationStatus?: string;
  verificationTeamName?: string;
  verificationTeamId?: number;
  verificationQty?: number | null;
  verificationVariance?: number | null;
  verificationCountedAt?: string | null;
  // Serial fields
  isSerialized?: boolean | number | null;
  isUnknownSerial?: boolean;
  isApprovedSerial?: boolean;
  serialNumber?: string;
  discrepancyId?: number;
  serialIndex?: number;
  stockStatus?: string | null;
  // Serial verification fields
  serialVerificationStatus?: string | null;
  serialVerificationTeamId?: number | null;
  serialVerificationTeamName?: string | null;
  serialVerificationResult?: string | null; // "confirmed" | "not_found"
}

export interface Team {
  id: number;
  name: string;
  members: string | null;
}

export interface EventOption {
  id: number;
  name: string;
  status: string;
}

export type VarianceSearchMode = "contains" | "starts" | "exact" | "bin";

export type AcceptAction = "accept_original" | "accept_verification";

/** A recount is in progress: the server rejects accept/edit until it is submitted. */
export function isRecountPending(v: Pick<VarianceItem, "verificationStatus">): boolean {
  return v.verificationStatus === "pending";
}

/**
 * Accepting or editing a count directly settles a completed-but-undecided
 * verification (the server marks it "accepted"); mirror that locally.
 */
export function closeVerification(status: string | undefined): string | undefined {
  return status === "completed" ? "accepted" : status;
}

export function filterVarianceItems(items: VarianceItem[], search: string, searchMode: VarianceSearchMode) {
  if (!search) return items;
  const q = search.toLowerCase();

  const matchField = (val: string | null | undefined): boolean => {
    if (!val) return false;
    const v = val.toLowerCase();
    switch (searchMode) {
      case "starts":
        return v.startsWith(q);
      case "exact":
        return v === q;
      case "bin":
        return false; // handled separately
      case "contains":
      default:
        return v.includes(q);
    }
  };

  if (searchMode === "bin") {
    return items.filter((v) => {
      const bin = (v.binNumber || "").toLowerCase();
      return bin.startsWith(q) || bin === q;
    });
  }

  return items.filter(
    (v) =>
      matchField(v.itemCode) ||
      matchField(v.description) ||
      matchField(v.binNumber) ||
      matchField(v.teamName)
  );
}

/** Total absolute variance value (R) of the selected active variances. */
export function selectedVarianceValue(activeVariances: VarianceItem[], selectedCountIds: Set<number>) {
  return activeVariances
    .filter((v) => selectedCountIds.has(v.countId))
    .reduce((sum, v) => sum + Math.abs(v.varianceValue), 0)
    .toLocaleString(undefined, { maximumFractionDigits: 0 });
}
