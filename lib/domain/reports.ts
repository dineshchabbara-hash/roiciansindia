import { ENROLLMENT_STATUSES } from "@/lib/domain/enrollments";
import { STUDENT_STATUSES } from "@/lib/domain/students";
import { CERTIFICATE_STATUSES } from "@/lib/domain/certificates";
import {
  CANCELLED_OR_WITHDRAWN_ENROLLMENT_STATUSES,
  CONFIRMED_ENROLLMENT_STATUSES,
  PIPELINE_ENROLLMENT_STATUSES,
  computeOutstandingFeesPaise,
} from "@/lib/domain/dashboard-metrics";
import { sumPaise, toPaise } from "@/lib/domain/money";
import type { CsvCell } from "@/lib/domain/csv";

/**
 * Pure Reports & Analytics domain logic (Phase 19 — REQUIREMENTS.md FR-120,
 * IMPLEMENTATION_PLAN.md Phase 19, API_AND_INTEGRATIONS.md §7) — no I/O.
 *
 * Everything that must be identical between the on-screen report and its
 * CSV export lives here, so the two can never drift: the filter parser
 * (one parser for both the page's searchParams and the export route's
 * query string), the sort whitelist, and each report's column list plus
 * row-to-cell mapping. The page renders exactly the cells the CSV writes.
 *
 * No business formula is defined here. Attendance figures come verbatim
 * from the Phase 13 student_attendance_summary view, and every money
 * figure comes from the Phase 14 engine (computeOutstandingFeesPaise /
 * sumPaise via lib/data/reports.ts) — this module only formats the
 * integer paise those return.
 */

export const REPORT_KINDS = [
  "students",
  "enrollments",
  "attendance",
  "financial",
  "certificates",
] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

export function isReportKind(value: unknown): value is ReportKind {
  return typeof value === "string" && (REPORT_KINDS as readonly string[]).includes(value);
}

export const REPORT_PAGE_SIZE = 25;

/**
 * Hard ceiling on one CSV export. An export whose filtered row count
 * exceeds this is refused up front with a "narrow your filters" message —
 * never silently cut off at the cap.
 */
export const REPORT_EXPORT_MAX_ROWS = 5000;

/** Rows fetched per round-trip while an export is being streamed. */
export const REPORT_EXPORT_BATCH_SIZE = 500;

// Upper bound on the page number accepted from a URL — far beyond any real
// page count, it only stops an absurd offset reaching the database.
const MAX_PAGE = 10_000;

// ---------------------------------------------------------------------------
// Financial status groups — the exact Phase 9/14 dashboard classification
// (lib/domain/dashboard-metrics.ts), reused rather than redefined, so the
// Financial report's "Confirmed" total and the dashboard's "Confirmed
// Unpaid Fees" are the same figure for the same rows.

export const FINANCIAL_GROUPS = [
  "confirmed",
  "pipeline",
  "cancelled_withdrawn",
  "all",
] as const;
export type FinancialGroup = (typeof FINANCIAL_GROUPS)[number];

export const FINANCIAL_GROUP_LABELS: Record<FinancialGroup, string> = {
  confirmed: "Confirmed (Enrolled, Active, On hold, Completed)",
  pipeline: "Pipeline (Lead, Applicant)",
  cancelled_withdrawn: "Cancelled or Withdrawn",
  all: "All enrollments",
};

export function financialGroupStatuses(group: FinancialGroup): readonly string[] | null {
  switch (group) {
    case "confirmed":
      return CONFIRMED_ENROLLMENT_STATUSES;
    case "pipeline":
      return PIPELINE_ENROLLMENT_STATUSES;
    case "cancelled_withdrawn":
      return CANCELLED_OR_WITHDRAWN_ENROLLMENT_STATUSES;
    case "all":
      return null;
  }
}

// ---------------------------------------------------------------------------
// Per-report configuration.

export type SortDirection = "asc" | "desc";

export type ReportSortOption = {
  label: string;
  /** Database columns, in order. The report's tie-breaker is appended after. */
  columns: readonly string[];
};

export type ReportDefinition = {
  kind: ReportKind;
  title: string;
  description: string;
  statuses: readonly string[] | null;
  supportsProgram: boolean;
  supportsBatch: boolean;
  /** Label for the date-range filter, or null when the report has none. */
  dateLabel: string | null;
  supportsBelow: boolean;
  supportsGroup: boolean;
  searchPlaceholder: string;
  sorts: Readonly<Record<string, ReportSortOption>>;
  defaultSort: string;
  defaultDirection: SortDirection;
  /** Unique, stable columns appended to every ORDER BY (deterministic paging). */
  tieBreaker: readonly string[];
};

export const REPORT_DEFINITIONS: Readonly<Record<ReportKind, ReportDefinition>> = {
  students: {
    kind: "students",
    title: "Student report",
    description: "Student records with contact details and enrollment count.",
    statuses: STUDENT_STATUSES,
    supportsProgram: true,
    supportsBatch: true,
    dateLabel: "Registered",
    supportsBelow: false,
    supportsGroup: false,
    searchPlaceholder: "Code, name, email or phone",
    sorts: {
      registered: { label: "Registration date", columns: ["registration_date"] },
      code: { label: "Student code", columns: ["student_code"] },
      name: { label: "Name", columns: ["last_name", "first_name"] },
      status: { label: "Status", columns: ["status"] },
    },
    defaultSort: "registered",
    defaultDirection: "desc",
    tieBreaker: ["id"],
  },
  enrollments: {
    kind: "enrollments",
    title: "Enrollment report",
    description: "Enrollments with student, program, batch and status.",
    statuses: ENROLLMENT_STATUSES,
    supportsProgram: true,
    supportsBatch: true,
    dateLabel: "Enrolled",
    supportsBelow: false,
    supportsGroup: false,
    searchPlaceholder: "Enrollment code, student code or name",
    sorts: {
      date: { label: "Enrollment date", columns: ["enrollment_date"] },
      code: { label: "Enrollment code", columns: ["enrollment_code"] },
      status: { label: "Status", columns: ["enrollment_status"] },
      student: {
        label: "Student name",
        columns: ["student_last_name", "student_first_name"],
      },
    },
    defaultSort: "date",
    defaultDirection: "desc",
    tieBreaker: ["id"],
  },
  attendance: {
    kind: "attendance",
    title: "Attendance report",
    description:
      "Per-enrollment attendance from marked sessions: Present + Late over sessions marked.",
    statuses: null,
    supportsProgram: true,
    supportsBatch: true,
    dateLabel: null,
    supportsBelow: true,
    supportsGroup: false,
    searchPlaceholder: "Student code or name",
    sorts: {
      percentage: { label: "Attendance %", columns: ["attendance_percentage"] },
      sessions: { label: "Sessions marked", columns: ["total_sessions"] },
    },
    defaultSort: "percentage",
    defaultDirection: "asc",
    tieBreaker: ["enrollment_id", "batch_id"],
  },
  financial: {
    kind: "financial",
    title: "Financial report",
    description:
      "Per-enrollment payable, paid, refunded and outstanding, from the payments engine.",
    statuses: null,
    supportsProgram: true,
    supportsBatch: true,
    dateLabel: "Enrolled",
    supportsBelow: false,
    supportsGroup: true,
    searchPlaceholder: "Enrollment code, student code or name",
    sorts: {
      date: { label: "Enrollment date", columns: ["enrollment_date"] },
      code: { label: "Enrollment code", columns: ["enrollment_code"] },
      payable: { label: "Total payable", columns: ["total_payable"] },
    },
    defaultSort: "date",
    defaultDirection: "desc",
    tieBreaker: ["id"],
  },
  certificates: {
    kind: "certificates",
    title: "Certificate report",
    description: "Issued and revoked certificates, kept distinct by status.",
    statuses: CERTIFICATE_STATUSES,
    supportsProgram: true,
    supportsBatch: false,
    dateLabel: "Issued",
    supportsBelow: false,
    supportsGroup: false,
    searchPlaceholder: "Certificate number, student code or name",
    sorts: {
      issued: { label: "Issue date", columns: ["issue_date"] },
      number: { label: "Certificate number", columns: ["certificate_number"] },
      status: { label: "Status", columns: ["status"] },
    },
    defaultSort: "issued",
    defaultDirection: "desc",
    tieBreaker: ["id"],
  },
};

// ---------------------------------------------------------------------------
// Filters — one parser for the page and the export route.

export type ReportFilters = {
  q: string;
  status: string | null;
  programId: string | null;
  batchId: string | null;
  from: string | null;
  to: string | null;
  below: number | null;
  group: FinancialGroup;
  sort: string;
  dir: SortDirection;
  page: number;
};

export type RawSearchParams = Record<string, string | string[] | undefined>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function first(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

/**
 * Keeps letters (any script, with their combining marks — e.g. the
 * Devanagari vowel signs in "आशा"), digits, spaces and the few punctuation marks
 * that appear in codes/emails/phones. Strips everything PostgREST's filter
 * grammar treats as syntax (commas, parentheses, quotes, `*`, `%`, `:`),
 * so a search term can never alter the shape of the `or=(…)` filter it is
 * interpolated into.
 */
export function sanitizeReportSearch(raw: string): string {
  return raw
    .replace(/[^\p{L}\p{M}\p{N} @._+-]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
}

export function isIsoDate(value: string): boolean {
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const [, y, m, d] = match.map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
  );
}

function parseUuid(value: string): string | null {
  const trimmed = value.trim();
  return UUID_PATTERN.test(trimmed) ? trimmed.toLowerCase() : null;
}

function parsePage(value: string): number {
  if (!/^\d{1,6}$/.test(value)) return 1;
  const n = Number(value);
  return n >= 1 ? Math.min(n, MAX_PAGE) : 1;
}

function parseBelow(value: string): number | null {
  if (!/^\d{1,3}$/.test(value)) return null;
  const n = Number(value);
  return n >= 1 && n <= 100 ? n : null;
}

/**
 * Normalizes untrusted query parameters into a report's filters. Anything
 * invalid or not supported by this report falls back to "no filter" (or
 * the default sort) rather than erroring — the same forgiving behavior as
 * the existing Admin list screens (e.g. app/admin/students/page.tsx).
 */
export function parseReportFilters(
  kind: ReportKind,
  raw: RawSearchParams,
): ReportFilters {
  const def = REPORT_DEFINITIONS[kind];

  const statusRaw = first(raw.status).trim();
  const status = def.statuses && def.statuses.includes(statusRaw) ? statusRaw : null;

  const fromRaw = first(raw.from).trim();
  const toRaw = first(raw.to).trim();
  const from = def.dateLabel && isIsoDate(fromRaw) ? fromRaw : null;
  const to = def.dateLabel && isIsoDate(toRaw) ? toRaw : null;

  const sortRaw = first(raw.sort).trim();
  const sort = Object.hasOwn(def.sorts, sortRaw) ? sortRaw : def.defaultSort;
  const dirRaw = first(raw.dir).trim();
  const dir: SortDirection =
    dirRaw === "asc" || dirRaw === "desc" ? dirRaw : def.defaultDirection;

  const groupRaw = first(raw.group).trim();
  const group: FinancialGroup =
    def.supportsGroup && (FINANCIAL_GROUPS as readonly string[]).includes(groupRaw)
      ? (groupRaw as FinancialGroup)
      : "confirmed";

  return {
    q: sanitizeReportSearch(first(raw.q)),
    status,
    programId: def.supportsProgram ? parseUuid(first(raw.programId)) : null,
    batchId: def.supportsBatch ? parseUuid(first(raw.batchId)) : null,
    from,
    to,
    below: def.supportsBelow ? parseBelow(first(raw.below).trim()) : null,
    group,
    sort,
    dir,
    page: parsePage(first(raw.page).trim()),
  };
}

/**
 * The inverse of parseReportFilters: the minimal query-string record that
 * reproduces these filters (defaults omitted). `page` is excluded — the
 * export link and the pagination links both build on this.
 */
export function reportFiltersToParams(
  kind: ReportKind,
  filters: ReportFilters,
): Record<string, string> {
  const def = REPORT_DEFINITIONS[kind];
  const params: Record<string, string> = {};
  if (filters.q) params.q = filters.q;
  if (filters.status) params.status = filters.status;
  if (filters.programId) params.programId = filters.programId;
  if (filters.batchId) params.batchId = filters.batchId;
  if (filters.from) params.from = filters.from;
  if (filters.to) params.to = filters.to;
  if (filters.below !== null) params.below = String(filters.below);
  if (def.supportsGroup && filters.group !== "confirmed") params.group = filters.group;
  if (filters.sort !== def.defaultSort) params.sort = filters.sort;
  if (filters.dir !== def.defaultDirection) params.dir = filters.dir;
  return params;
}

export function reportExportHref(kind: ReportKind, filters: ReportFilters): string {
  const query = new URLSearchParams(reportFiltersToParams(kind, filters)).toString();
  return `/api/exports/${kind}${query ? `?${query}` : ""}`;
}

export function reportExportFileName(kind: ReportKind, now: Date): string {
  // en-CA formats as YYYY-MM-DD; Asia/Kolkata matches the business's day.
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now);
  return `${kind}-report-${day}.csv`;
}

// ---------------------------------------------------------------------------
// Formatting helpers (integer/string only — never float arithmetic on money).

/** Integer paise -> exact decimal rupee string, e.g. 123450 -> "1234.50". */
export function paiseToDecimalString(paise: number): string {
  if (!Number.isSafeInteger(paise)) {
    throw new Error(`paise must be a safe integer, received ${paise}`);
  }
  const sign = paise < 0 ? "-" : "";
  const abs = Math.abs(paise);
  return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/**
 * The view's numeric(…, 2) percentage arrives as a JSON number or string
 * (PostgREST emits numeric unquoted). Rendered with exactly two decimals;
 * the value was already rounded to two places by Postgres.
 */
export function formatPercentage(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "number") return Number.isFinite(value) ? value.toFixed(2) : "";
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return "";
  return `${match[1]}.${((match[2] ?? "") + "00").slice(0, 2)}`;
}

/**
 * numerator / denominator as a two-decimal percentage string, rounded half
 * up in integer basis points (e.g. 2/3 -> "66.67"), or null with no
 * denominator. Used for the overview's overall attendance rate, which
 * applies the Phase 13 rule (Present + Late over sessions marked) to the
 * global counts.
 */
export function formatRatioPercent(
  numerator: number,
  denominator: number,
): string | null {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator)) return null;
  if (denominator <= 0 || numerator < 0) return null;
  const basisPoints = Math.floor(
    (numerator * 10000 * 2 + denominator) / (denominator * 2),
  );
  return `${Math.trunc(basisPoints / 100)}.${String(basisPoints % 100).padStart(2, "0")}`;
}

export function humanizeStatus(status: string): string {
  const spaced = status.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

const IST_DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" });

/** A timestamptz as its Asia/Kolkata calendar date, YYYY-MM-DD. */
export function formatTimestampAsIstDate(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : IST_DATE.format(date);
}

function fullName(firstName: string, lastName: string): string {
  return `${firstName} ${lastName}`.trim();
}

// ---------------------------------------------------------------------------
// Row shapes and columns. `kind` tells the page how to present a cell
// (money gets an INR prefix, numbers align right); the CSV writes the raw
// cell text unchanged.

export type ReportColumnKind = "text" | "number" | "money" | "percent";
export type ReportColumn = { header: string; kind: ReportColumnKind };

export type StudentReportRow = {
  id: string;
  studentCode: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string;
  status: string;
  registrationDate: string;
  enrollmentCount: number;
};

export type EnrollmentReportRow = {
  id: string;
  enrollmentCode: string;
  enrollmentDate: string;
  status: string;
  studentCode: string;
  studentFirstName: string;
  studentLastName: string;
  programName: string;
  batchName: string | null;
};

export type AttendanceReportRow = {
  enrollmentId: string;
  batchId: string;
  enrollmentCode: string;
  studentCode: string;
  studentFirstName: string;
  studentLastName: string;
  programName: string;
  batchName: string;
  totalSessions: number;
  presentCount: number;
  lateCount: number;
  absentCount: number;
  excusedCount: number;
  attendancePercentage: string | number | null;
};

export type FinancialReportRow = {
  id: string;
  enrollmentCode: string;
  enrollmentDate: string;
  status: string;
  studentCode: string;
  studentFirstName: string;
  studentLastName: string;
  programName: string;
  batchName: string | null;
  totalPayablePaise: number;
  totalPaidPaise: number;
  totalRefundedPaise: number;
  outstandingPaise: number;
};

export type CertificateReportRow = {
  id: string;
  certificateNumber: string;
  status: string;
  issueDate: string;
  completionDate: string;
  revokedAt: string | null;
  studentCode: string;
  studentFirstName: string;
  studentLastName: string;
  programName: string;
  enrollmentCode: string;
};

export type ReportRowByKind = {
  students: StudentReportRow;
  enrollments: EnrollmentReportRow;
  attendance: AttendanceReportRow;
  financial: FinancialReportRow;
  certificates: CertificateReportRow;
};

export const REPORT_COLUMNS: Readonly<Record<ReportKind, readonly ReportColumn[]>> = {
  students: [
    { header: "Student code", kind: "text" },
    { header: "First name", kind: "text" },
    { header: "Last name", kind: "text" },
    { header: "Email", kind: "text" },
    { header: "Phone", kind: "text" },
    { header: "Status", kind: "text" },
    { header: "Registration date", kind: "text" },
    { header: "Enrollments", kind: "number" },
  ],
  enrollments: [
    { header: "Enrollment code", kind: "text" },
    { header: "Enrollment date", kind: "text" },
    { header: "Status", kind: "text" },
    { header: "Student code", kind: "text" },
    { header: "Student name", kind: "text" },
    { header: "Program", kind: "text" },
    { header: "Batch", kind: "text" },
  ],
  attendance: [
    { header: "Enrollment code", kind: "text" },
    { header: "Student code", kind: "text" },
    { header: "Student name", kind: "text" },
    { header: "Program", kind: "text" },
    { header: "Batch", kind: "text" },
    { header: "Sessions marked", kind: "number" },
    { header: "Present", kind: "number" },
    { header: "Late", kind: "number" },
    { header: "Absent", kind: "number" },
    { header: "Excused", kind: "number" },
    { header: "Attendance %", kind: "percent" },
  ],
  financial: [
    { header: "Enrollment code", kind: "text" },
    { header: "Enrollment date", kind: "text" },
    { header: "Status", kind: "text" },
    { header: "Student code", kind: "text" },
    { header: "Student name", kind: "text" },
    { header: "Program", kind: "text" },
    { header: "Batch", kind: "text" },
    { header: "Total payable", kind: "money" },
    { header: "Total paid", kind: "money" },
    { header: "Total refunded", kind: "money" },
    { header: "Outstanding", kind: "money" },
  ],
  certificates: [
    { header: "Certificate number", kind: "text" },
    { header: "Status", kind: "text" },
    { header: "Issue date", kind: "text" },
    { header: "Completion date", kind: "text" },
    { header: "Revoked on", kind: "text" },
    { header: "Student code", kind: "text" },
    { header: "Student name", kind: "text" },
    { header: "Program", kind: "text" },
    { header: "Enrollment code", kind: "text" },
  ],
};

export function reportHeaders(kind: ReportKind): string[] {
  return REPORT_COLUMNS[kind].map((column) => column.header);
}

/**
 * The single row-to-cells mapping both the page and the CSV use. Every
 * cell is a string or an integer — money as an exact decimal string from
 * integer paise, percentages as the view's own two-decimal value.
 */
export function reportRowCells<K extends ReportKind>(
  kind: K,
  row: ReportRowByKind[K],
): CsvCell[] {
  switch (kind) {
    case "students": {
      const r = row as StudentReportRow;
      return [
        r.studentCode,
        r.firstName,
        r.lastName,
        r.email ?? "",
        r.phone,
        humanizeStatus(r.status),
        r.registrationDate,
        r.enrollmentCount,
      ];
    }
    case "enrollments": {
      const r = row as EnrollmentReportRow;
      return [
        r.enrollmentCode,
        r.enrollmentDate,
        humanizeStatus(r.status),
        r.studentCode,
        fullName(r.studentFirstName, r.studentLastName),
        r.programName,
        r.batchName ?? "",
      ];
    }
    case "attendance": {
      const r = row as AttendanceReportRow;
      return [
        r.enrollmentCode,
        r.studentCode,
        fullName(r.studentFirstName, r.studentLastName),
        r.programName,
        r.batchName,
        r.totalSessions,
        r.presentCount,
        r.lateCount,
        r.absentCount,
        r.excusedCount,
        formatPercentage(r.attendancePercentage),
      ];
    }
    case "financial": {
      const r = row as FinancialReportRow;
      return [
        r.enrollmentCode,
        r.enrollmentDate,
        humanizeStatus(r.status),
        r.studentCode,
        fullName(r.studentFirstName, r.studentLastName),
        r.programName,
        r.batchName ?? "",
        paiseToDecimalString(r.totalPayablePaise),
        paiseToDecimalString(r.totalPaidPaise),
        paiseToDecimalString(r.totalRefundedPaise),
        paiseToDecimalString(r.outstandingPaise),
      ];
    }
    case "certificates": {
      const r = row as CertificateReportRow;
      return [
        r.certificateNumber,
        humanizeStatus(r.status),
        r.issueDate,
        r.completionDate,
        formatTimestampAsIstDate(r.revokedAt),
        r.studentCode,
        fullName(r.studentFirstName, r.studentLastName),
        r.programName,
        r.enrollmentCode,
      ];
    }
  }
  throw new Error(`Unknown report kind: ${String(kind)}`);
}

// ---------------------------------------------------------------------------
// Per-enrollment financial figures — the exact composition of
// lib/data/enrollments.ts's getEnrollmentFinancialSummary (the Phase 14
// authoritative engine): payable = toPaise(total_payable), paid =
// sumPaise(paid payments' total_amount), refunded = sumPaise(processed
// refunds' amount), outstanding = computeOutstandingFeesPaise fed this one
// enrollment's own slice. The only difference is where the rows come from:
// the report fetches paid payments/processed refunds for a whole page of
// enrollments in one round-trip, then hands each enrollment ONLY its own
// rows (filtered by enrollment_id here), so another enrollment's payment can
// never leak into this figure. Parity with getEnrollmentFinancialSummary is
// pinned by lib/domain/__tests__/reports.test.ts and the Phase 19 E2E
// reconciliation test.

export type EnrollmentFinancialFigures = Pick<
  FinancialReportRow,
  "totalPayablePaise" | "totalPaidPaise" | "totalRefundedPaise" | "outstandingPaise"
>;

export function computeEnrollmentFinancialFigures(
  enrollment: { id: string; total_payable: string | number },
  paidPayments: ReadonlyArray<{ enrollment_id: string; total_amount: string | number }>,
  processedRefunds: ReadonlyArray<{ enrollment_id: string; amount: string | number }>,
): EnrollmentFinancialFigures {
  const paidRows = paidPayments.filter((p) => p.enrollment_id === enrollment.id);
  const refundRows = processedRefunds.filter((r) => r.enrollment_id === enrollment.id);
  const { totalOutstandingPaise } = computeOutstandingFeesPaise(
    [enrollment],
    paidRows,
    refundRows,
  );
  return {
    totalPayablePaise: toPaise(enrollment.total_payable),
    totalPaidPaise: sumPaise(paidRows.map((p) => p.total_amount)),
    totalRefundedPaise: sumPaise(refundRows.map((r) => r.amount)),
    outstandingPaise: totalOutstandingPaise,
  };
}

// ---------------------------------------------------------------------------
// Financial totals for a filtered set — sums of the engine's own
// per-enrollment figures, never a second formula.

export type FinancialReportTotals = {
  enrollmentCount: number;
  totalPayablePaise: number;
  totalPaidPaise: number;
  totalRefundedPaise: number;
  outstandingPaise: number;
};

export function sumFinancialRows(
  rows: ReadonlyArray<
    Pick<
      FinancialReportRow,
      "totalPayablePaise" | "totalPaidPaise" | "totalRefundedPaise" | "outstandingPaise"
    >
  >,
): FinancialReportTotals {
  return rows.reduce<FinancialReportTotals>(
    (acc, r) => ({
      enrollmentCount: acc.enrollmentCount + 1,
      totalPayablePaise: acc.totalPayablePaise + r.totalPayablePaise,
      totalPaidPaise: acc.totalPaidPaise + r.totalPaidPaise,
      totalRefundedPaise: acc.totalRefundedPaise + r.totalRefundedPaise,
      outstandingPaise: acc.outstandingPaise + r.outstandingPaise,
    }),
    {
      enrollmentCount: 0,
      totalPayablePaise: 0,
      totalPaidPaise: 0,
      totalRefundedPaise: 0,
      outstandingPaise: 0,
    },
  );
}
