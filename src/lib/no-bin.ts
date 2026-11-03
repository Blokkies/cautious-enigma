/**
 * Bin number stored for items imported with a blank bin, mirroring NO_WAREHOUSE: every item
 * then belongs to a real (warehouse, bin) pair, so it can be listed and assigned on the
 * assignment page (activation requires every in-scope item to be assigned).
 */
export const NO_BIN = "(No bin)";

/** Normalize an imported bin number: blank/whitespace becomes NO_BIN. */
export function normalizeBin(val: string | null | undefined): string {
  const trimmed = (val ?? "").trim();
  return trimmed.length > 0 ? trimmed : NO_BIN;
}
