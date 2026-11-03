// Display formatting shared by the admin area. Deterministic (no locale lookups),
// so server and client render identical text.

/** Group an integer string in threes with a space: "1234567" -> "1 234 567". */
function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/** A whole or fixed-decimal number with space thousands separators: 1234.5 -> "1 234.5" (decimals = 1). */
export function formatNumber(value: number | null | undefined, decimals = 0): string {
  const n = typeof value === "number" && Number.isFinite(value) ? value : 0;
  const fixed = Math.abs(n).toFixed(decimals);
  const [int, frac] = fixed.split(".");
  const negative = n < 0 && Number(fixed) !== 0;
  return `${negative ? "-" : ""}${groupThousands(int)}${frac ? `.${frac}` : ""}`;
}

export interface MoneyOptions {
  /** Decimal places (default 2). Use 0 for headline tiles. */
  decimals?: number;
  /** Prefix positive values with "+" (for net variance). */
  signed?: boolean;
}

/**
 * South African Rand: formatMoney(1234.5) -> "R 1 234.50", formatMoney(-50, { decimals: 0 }) -> "-R 50".
 * null/undefined/NaN format as zero.
 */
export function formatMoney(value: number | null | undefined, options: MoneyOptions = {}): string {
  const { decimals = 2, signed = false } = options;
  const n = typeof value === "number" && Number.isFinite(value) ? value : 0;
  const body = formatNumber(Math.abs(n), decimals);
  const isZero = Number(Math.abs(n).toFixed(decimals)) === 0;
  const sign = isZero ? "" : n < 0 ? "-" : signed ? "+" : "";
  return `${sign}R ${body}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-11-03" (or an ISO timestamp) -> "3 Nov 2026". Unparseable/empty -> "". */
export function formatDate(value: string | null | undefined): string {
  if (!value) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!m) return "";
  const month = MONTHS[Number(m[2]) - 1];
  if (!month) return "";
  return `${Number(m[3])} ${month} ${m[1]}`;
}

/**
 * Event date range for headers: "3 Nov 2026", "3 Nov 2026 – 5 Nov 2026", "From 3 Nov 2026",
 * "Until 5 Nov 2026", or "" when neither date is set.
 */
export function formatDateRange(start: string | null | undefined, end: string | null | undefined): string {
  const s = formatDate(start);
  const e = formatDate(end);
  if (s && e) return s === e ? s : `${s} – ${e}`;
  if (s) return `From ${s}`;
  if (e) return `Until ${e}`;
  return "";
}

/**
 * A count with the right noun form, numbers grouped like formatNumber:
 * plural(1, "item") -> "1 item", plural(1234, "item") -> "1 234 items",
 * plural(2, "query", "queries") -> "2 queries". Non-finite counts read as 0.
 */
export function plural(count: number | null | undefined, singular: string, pluralForm?: string): string {
  const n = typeof count === "number" && Number.isFinite(count) ? count : 0;
  return `${formatNumber(n)} ${pluralWord(n, singular, pluralForm)}`;
}

/** Just the noun form for a count: pluralWord(1, "bin") -> "bin", pluralWord(0, "bin") -> "bins". */
export function pluralWord(count: number | null | undefined, singular: string, pluralForm?: string): string {
  return count === 1 ? singular : (pluralForm ?? `${singular}s`);
}
