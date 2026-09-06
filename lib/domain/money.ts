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
