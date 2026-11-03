/** Largest accepted import file (it is held in memory and stored in the database). */
export const MAX_FILE_SIZE = 50 * 1024 * 1024;

/**
 * Largest accepted import request body: the file plus multipart overhead and the other
 * fields. Keep `experimental.proxyClientMaxBodySize` in next.config.mjs at least this
 * large, or the proxy truncates bigger bodies before they reach the route.
 */
export const MAX_REQUEST_SIZE = MAX_FILE_SIZE + 5 * 1024 * 1024;

export const FILE_TOO_LARGE = "File too large. Maximum size is 50MB.";

/**
 * The warehouse selection to keep after re-importing/copying into an event: the previously
 * selected warehouses that still exist in the new data. Falls back to all warehouses when
 * the event had no selection, everything was selected before (so new warehouses are
 * included too), or none of the selected warehouses survive.
 */
export function carryOverWarehouseSelection(
  previousSelection: string[] | null,
  previousWarehouses: string[],
  newWarehouses: string[]
): string[] {
  if (!previousSelection || previousSelection.length === 0) return newWarehouses;
  const prev = new Set(previousSelection);
  if (previousWarehouses.length > 0 && previousWarehouses.every((w) => prev.has(w))) return newWarehouses;
  const kept = newWarehouses.filter((w) => prev.has(w));
  return kept.length > 0 ? kept : newWarehouses;
}
