/**
 * Decimal-safe money helpers. Postgres `numeric` columns arrive over the
 * wire as strings (e.g. "20000.00") specifically to avoid JS float
 * precision loss in transit (DATABASE_SCHEMA.md §7) — these helpers keep
 * that guarantee through accumulation by working in integer paise
 * internally, never summing raw floats.
 */

/** Parses a Postgres numeric string into integer paise. Never NaN. */
export function toPaise(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const n = typeof value === "number" ? value : parseFloat(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

/** Sums a list of Postgres numeric strings without floating-point drift. */
export function sumPaise(values: Array<string | number | null | undefined>): number {
  return values.reduce<number>((total, v) => total + toPaise(v), 0);
}

/** Converts integer paise back to a plain rupee number (for display/math). */
export function paiseToRupees(paise: number): number {
  return paise / 100;
}

const inrFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

/** Formats integer paise as a whole-rupee INR string, e.g. "₹1,20,000". */
export function formatPaiseAsINR(paise: number): string {
  return inrFormatter.format(paiseToRupees(paise));
}

// Matches a plain non-negative decimal with at most 2 fraction digits —
// exactly the shape a `numeric(_, 2)` column returns over the wire (e.g.
// "500.50", "50000.99", "50000" if unscaled). Deliberately not shared with
// toPaise/formatPaiseAsINR above: those exist for *whole-rupee* amounts
// (payments/dashboard) where collapsing to an integer is correct by design.
// A field that can genuinely hold cents — like Program fees — must never
// go through that path, since Intl.NumberFormat's `maximumFractionDigits: 0`
// there rounds e.g. 500.50 up to "₹501", silently discarding the cents.
const RUPEES_WITH_CENTS_PATTERN = /^(\d+)(?:\.(\d{1,2}))?$/;

/**
 * Formats a `numeric(_, 2)` decimal string as INR *with* its exact cents,
 * e.g. "500.50" -> "₹500.50", "50000" -> "₹50,000.00". Built entirely from
 * string manipulation (Indian-style lakh/crore digit grouping done by
 * regex, not division/rounding) — never `Number()`/`parseFloat` — so it
 * can never reintroduce the float-rounding bug this helper exists to fix.
 * Use this instead of formatPaiseAsINR for any field that can hold cents.
 */
export function formatDecimalAsINR(value: string | null | undefined): string {
  const match = RUPEES_WITH_CENTS_PATTERN.exec((value ?? "0").trim());
  if (!match) return "₹0.00";

  const [, integerPart, decimalPart = ""] = match;
  const cents = (decimalPart + "00").slice(0, 2);

  const lastThree = integerPart.slice(-3);
  const rest = integerPart.slice(0, -3);
  const groupedInteger = rest
    ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${lastThree}`
    : lastThree;

  return `₹${groupedInteger}.${cents}`;
}
