/**
 * Pure CSV serialization for the Phase 19 report exports — no I/O. RFC 4180
 * shape (comma separator, CRLF record terminator, double-quote quoting with
 * embedded quotes doubled) plus spreadsheet formula-injection protection.
 *
 * Formula injection (OWASP "CSV Injection"): a spreadsheet application
 * evaluates a cell whose text begins with `=`, `+`, `-` or `@` (and, in some
 * applications, a leading tab or carriage return) as a formula. Every
 * user-controlled text value in a report (names, emails, codes, reasons)
 * could carry such a prefix, so any string cell starting with one of those
 * characters is neutralized by prefixing a single quote — the mitigation
 * OWASP recommends — before quoting. The cost is that a legitimate value
 * such as a phone number written "+91…" exports as "'+91…"; that trade-off
 * is deliberate (a report export must never be able to run a formula).
 *
 * Only `string` cells are neutralized. A JS `number` cell is emitted as its
 * plain decimal text — the report layer only ever passes integers (counts)
 * or pre-formatted decimal strings for money/percentages, never a float
 * computed in JavaScript.
 */

export type CsvCell = string | number | null | undefined;

// Leading characters a spreadsheet may interpret as the start of a formula.
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

// A field must be quoted when it contains the separator, a quote, a line
// break, or leading/trailing whitespace (some readers trim unquoted fields).
const NEEDS_QUOTING = /[",\r\n]|^\s|\s$/;

export const CSV_RECORD_SEPARATOR = "\r\n";

/**
 * UTF-8 byte-order mark. Prepended once at the start of an export so
 * spreadsheet applications (notably Excel on Windows) detect UTF-8 and
 * render non-ASCII names (e.g. Devanagari) correctly instead of as mojibake.
 */
export const CSV_UTF8_BOM = "﻿";

export function neutralizeFormula(value: string): string {
  return FORMULA_PREFIX.test(value) ? `'${value}` : value;
}

export function escapeCsvCell(value: CsvCell): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "";
  }
  const safe = neutralizeFormula(value);
  return NEEDS_QUOTING.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsvRecord(cells: readonly CsvCell[]): string {
  return cells.map(escapeCsvCell).join(",") + CSV_RECORD_SEPARATOR;
}

/** Serializes a header row plus data rows into one CSV document (no BOM). */
export function toCsv(
  headers: readonly string[],
  rows: ReadonlyArray<readonly CsvCell[]>,
): string {
  return [headers, ...rows].map((row) => toCsvRecord(row)).join("");
}
