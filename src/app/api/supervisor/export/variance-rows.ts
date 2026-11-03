import { getCountableDiscrepancySerials, isRefOutsideWarehouses, type ItemRef } from "@/lib/api-auth";
import { safeJsonParse } from "@/lib/utils";

/**
 * Pure row builders for the variance exports.
 *
 * Two audiences:
 * - "review": the general variances / variances_all exports. Every variance,
 *   whatever its review state, with a Check Status column.
 * - "netsuite": the four adjustment files (nonserialized/serialized up/down)
 *   that are imported into NetSuite. Only reviewed variances belong there:
 *   counts with checkStatus 'accepted', and approved serials of discrepancies
 *   that have been resolved.
 */
export type VarianceAudience = "review" | "netsuite";

/** Export types that feed NetSuite inventory adjustments. */
export const NETSUITE_ADJUSTMENT_TYPES = [
  "variances_nonserialized_up",
  "variances_nonserialized_down",
  "variances_serialized_up",
  "variances_serialized_down",
] as const;

export function isNetsuiteAdjustmentType(type: string): boolean {
  return (NETSUITE_ADJUSTMENT_TYPES as readonly string[]).includes(type);
}

export interface DiscrepancyExportRow {
  itemCode: string;
  description: string | null;
  binNumber: string | null;
  binInternalId: string | null;
  unknownSerials: string | null;
  approvedSerials: string | null;
  status: string | null;
  resolutionType: string | null;
  teamName: string;
}

/**
 * Serials of one discrepancy that may go into a NetSuite adjustment file, and
 * how many of its serials are held back because they have not been reviewed.
 * - resolved: the approved serials are included; leftover unknowns were
 *   dismissed by the resolution, so they are neither included nor "unreviewed".
 * - open: nothing is included; open unknowns and serials approved so far are
 *   all held back until the discrepancy is resolved.
 */
export function netsuiteDiscrepancySerials(disc: Pick<DiscrepancyExportRow, "status" | "unknownSerials" | "approvedSerials">): {
  included: string[];
  unreviewed: number;
} {
  if (disc.status === "resolved") {
    return { included: safeJsonParse<string[]>(disc.approvedSerials, []), unreviewed: 0 };
  }
  const { unknowns, approved } = getCountableDiscrepancySerials(disc);
  return { included: [], unreviewed: unknowns.length + approved.length };
}

function discSerialRow(
  disc: DiscrepancyExportRow,
  ref: ItemRef | undefined,
  serial: string,
  checkStatus: "pending" | "accepted",
  comment: string,
): Record<string, unknown> {
  return {
    "Item Internal ID": ref?.internalId ?? null,
    "Item Code": disc.itemCode,
    "Description": disc.description,
    "Brand": ref?.brand ?? null,
    "Category": ref?.category ?? null,
    "Bin Number": disc.binNumber,
    "Bin Internal ID": disc.binInternalId,
    "Warehouse": ref?.warehouse ?? null,
    "Division": ref?.division ?? null,
    "Stock Status": ref?.stockStatus ?? null,
    "Serial Number": serial,
    "On Hand": 0,
    "Avg Cost": ref?.avgCost ?? null,
    "Counted Qty": 1,
    "Variance": 1,
    "Variance Value": ref?.avgCost != null ? 1 * ref.avgCost : null,
    "Check Status": checkStatus,
    "Count Type": "initial",
    "Team": disc.teamName,
    "Comment": comment,
    "Counted At": null,
  };
}

/** Surplus (variance +1) rows for unknown/approved serials reported as discrepancies. */
export function buildDiscrepancyRows(
  discRows: DiscrepancyExportRow[],
  refMap: Map<string, ItemRef>,
  warehouses: string[] | null,
  audience: VarianceAudience,
): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  for (const disc of discRows) {
    const ref = refMap.get(disc.itemCode);
    // Skip if source item's warehouse is not in the event's selected warehouses
    if (isRefOutsideWarehouses(ref, warehouses)) continue;

    if (audience === "netsuite") {
      for (const serial of netsuiteDiscrepancySerials(disc).included) {
        rows.push(discSerialRow(disc, ref, serial, "accepted", "Approved unknown serial"));
      }
      continue;
    }

    // Resolved discrepancies contribute only their approved serials
    const { unknowns, approved } = getCountableDiscrepancySerials(disc);
    for (const serial of unknowns) {
      rows.push(discSerialRow(disc, ref, serial, "pending", "Unknown serial reported during count"));
    }
    for (const serial of approved) {
      rows.push(discSerialRow(disc, ref, serial, "accepted", "Approved unknown serial"));
    }
  }
  return rows;
}

/** Unreviewed discrepancy serials that the NetSuite files leave out. */
export function countUnreviewedDiscrepancySerials(
  discRows: DiscrepancyExportRow[],
  refMap: Map<string, ItemRef>,
  warehouses: string[] | null,
): number {
  let n = 0;
  for (const disc of discRows) {
    if (isRefOutsideWarehouses(refMap.get(disc.itemCode), warehouses)) continue;
    n += netsuiteDiscrepancySerials(disc).unreviewed;
  }
  return n;
}

function serialKey(row: Record<string, unknown>): string | null {
  const serial = row["Serial Number"];
  if (serial === null || serial === undefined || serial === "") return null;
  return `${String(row["Item Code"] ?? "").trim().toUpperCase()}|${String(serial).trim().toUpperCase()}`;
}

/**
 * Serialized surplus for NetSuite: accepted over-counts on expected serial
 * rows plus approved serials from resolved discrepancies.
 *
 * Unknown serials are by construction serials the team could not match to an
 * expected row, but a supervisor can approve a serial that is also an expected
 * serial (e.g. found in a different bin, or a typo corrected on edit). The same
 * physical unit must only be adjusted up once, so a discrepancy serial whose
 * item code + serial number already appears as an over-counted expected row is
 * dropped. Within the discrepancy rows the same serial is also kept once.
 */
export function mergeSerializedUpRows(
  countRows: Record<string, unknown>[],
  discrepancyRows: Record<string, unknown>[],
): Record<string, unknown>[] {
  const seen = new Set<string>();
  for (const row of countRows) {
    const key = serialKey(row);
    if (key) seen.add(key);
  }
  const merged = [...countRows];
  for (const row of discrepancyRows) {
    const key = serialKey(row);
    if (key) {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    merged.push(row);
  }
  return merged;
}
