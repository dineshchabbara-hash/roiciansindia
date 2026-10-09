import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { DataResult } from "@/lib/data/dashboard";
import { toPaise } from "@/lib/domain/money";
import {
  PAYMENT_LEDGER_PAGE_SIZE,
  istDayStartUtc,
  nextIsoDate,
  normalizeEnrollmentCode,
  type PaymentLedgerFilters,
} from "@/lib/domain/payments";
import type { RecordOfflinePaymentInput } from "@/lib/validation/payments";

/**
 * Phase 20A (Offline Payments Ledger) data layer.
 *
 * Reads run through the caller's own RLS-scoped session: payments_select_
 * admin gives Admin/Super Admin every row; a Student would only ever see
 * their own (payments_select_own) and a Trainer nothing — and neither
 * reaches this module, since every page/action using it is Admin-gated.
 *
 * The ONLY write is recordOfflinePayment(), which calls the
 * record_offline_payment() database function (20260101000035) through the
 * same session. That function is the single end-user write path into
 * `payments`: it re-checks Admin/Super Admin, locks the enrollment,
 * requires a confirmed status, blocks overpayment against the Phase 14
 * outstanding formula, derives student and recording admin itself, and is
 * idempotent on the form's server-minted payment id. Nothing here can
 * update or delete a payment — no policy allows it, and a settled payment
 * is frozen by trigger for every role (FR-91).
 *
 * Financial figures shown alongside a payment (payable / paid / refunded /
 * outstanding) are never computed here: callers use
 * lib/data/enrollments.ts's getEnrollmentFinancialSummary (the Phase 14
 * engine).
 */

type ServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

class PaymentQueryError extends Error {}

function fail<T>(message: string, error: unknown): DataResult<T> {
  if (error instanceof PaymentQueryError) return { ok: false, error: error.message };
  console.error(`[payments data] ${message}:`, error);
  return { ok: false, error: message };
}

// A free-text search is resolved to student / enrollment ids first. Above
// this many matches the search is refused as too broad rather than
// silently truncated (same rule as the Phase 19 reports).
const MAX_SEARCH_IDS = 200;

function ilikeAny(columns: readonly string[], q: string): string {
  // q is sanitized by parsePaymentLedgerFilters (sanitizeReportSearch): no
  // commas, parentheses, quotes, `*`, `%` or `:` can reach the or=(…) list.
  return columns.map((column) => `${column}.ilike.%${q}%`).join(",");
}

async function resolveIds(
  supabase: ServerClient,
  table: "students" | "enrollments",
  columns: readonly string[],
  q: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from(table)
    .select("id")
    .or(ilikeAny(columns, q))
    .order("id")
    .limit(MAX_SEARCH_IDS + 1);
  if (error) throw error;
  const ids = (data ?? []).map((row) => row.id as string);
  if (ids.length > MAX_SEARCH_IDS) {
    throw new PaymentQueryError(
      `The search matches more than ${MAX_SEARCH_IDS} ${table}. Refine the search.`,
    );
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Ledger

export type PaymentLedgerRow = {
  id: string;
  paymentCode: string;
  paidAt: string | null;
  createdAt: string;
  amountPaise: number;
  method: string;
  paymentType: string;
  status: string;
  reference: string | null;
  enrollmentId: string;
  enrollmentCode: string;
  studentId: string;
  studentCode: string;
  studentName: string;
  programName: string;
  batchName: string | null;
};

export type PaymentLedgerPage = {
  rows: PaymentLedgerRow[];
  total: number;
  page: number;
  pageSize: number;
};

// No auth ids, no razorpay_* fields, no notes in the list (notes are on the
// detail page). created_by is an admins.id, never displayed.
const LEDGER_SELECT =
  "id, payment_code, paid_at, created_at, total_amount, method, payment_type, status, internal_reference, enrollment_id, student_id, enrollment:enrollments(enrollment_code, program:programs(name), batch:batches(name)), student:students(student_code, first_name, last_name)";

type LedgerRowDb = {
  id: string;
  payment_code: string;
  paid_at: string | null;
  created_at: string;
  total_amount: string | number;
  method: string;
  payment_type: string;
  status: string;
  internal_reference: string | null;
  enrollment_id: string;
  student_id: string;
  enrollment: {
    enrollment_code: string;
    program: { name: string } | null;
    batch: { name: string } | null;
  } | null;
  student: { student_code: string; first_name: string; last_name: string } | null;
};

function mapLedgerRow(row: LedgerRowDb): PaymentLedgerRow {
  return {
    id: row.id,
    paymentCode: row.payment_code,
    paidAt: row.paid_at,
    createdAt: row.created_at,
    amountPaise: toPaise(row.total_amount),
    method: row.method,
    paymentType: row.payment_type,
    status: row.status,
    reference: row.internal_reference,
    enrollmentId: row.enrollment_id,
    enrollmentCode: row.enrollment?.enrollment_code ?? "—",
    studentId: row.student_id,
    studentCode: row.student?.student_code ?? "—",
    studentName: row.student
      ? `${row.student.first_name} ${row.student.last_name}`.trim()
      : "Unknown student",
    programName: row.enrollment?.program?.name ?? "—",
    batchName: row.enrollment?.batch?.name ?? null,
  };
}

export async function getPaymentLedgerPage(
  filters: PaymentLedgerFilters,
): Promise<DataResult<PaymentLedgerPage>> {
  try {
    const supabase = await createSupabaseServerClient();

    // Search terms are resolved to ids before the paged query is built.
    let searchClause: string | null = null;
    if (filters.q) {
      const [studentIds, enrollmentIds] = await Promise.all([
        resolveIds(
          supabase,
          "students",
          ["student_code", "first_name", "last_name"],
          filters.q,
        ),
        resolveIds(supabase, "enrollments", ["enrollment_code"], filters.q),
      ]);
      const clauses = [ilikeAny(["payment_code", "internal_reference"], filters.q)];
      if (studentIds.length > 0) clauses.push(`student_id.in.(${studentIds.join(",")})`);
      if (enrollmentIds.length > 0)
        clauses.push(`enrollment_id.in.(${enrollmentIds.join(",")})`);
      searchClause = clauses.join(",");
    }

    let query = supabase.from("payments").select(LEDGER_SELECT, { count: "exact" });

    if (filters.method) query = query.eq("method", filters.method);
    if (filters.status) query = query.eq("status", filters.status);
    // Payment date = the Asia/Kolkata day the money was received.
    if (filters.from) query = query.gte("paid_at", istDayStartUtc(filters.from));
    if (filters.to) query = query.lt("paid_at", istDayStartUtc(nextIsoDate(filters.to)));

    if (searchClause) query = query.or(searchClause);

    const from = (filters.page - 1) * PAYMENT_LEDGER_PAGE_SIZE;
    const { data, error, count } = await query
      .order("paid_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, from + PAYMENT_LEDGER_PAGE_SIZE - 1);
    if (error) throw error;

    return {
      ok: true,
      data: {
        rows: ((data ?? []) as unknown as LedgerRowDb[]).map(mapLedgerRow),
        total: count ?? 0,
        page: filters.page,
        pageSize: PAYMENT_LEDGER_PAGE_SIZE,
      },
    };
  } catch (error) {
    return fail("Could not load payments.", error);
  }
}

// ---------------------------------------------------------------------------
// Detail

export type PaymentDetail = PaymentLedgerRow & {
  taxAmountPaise: number;
  notes: string | null;
  /** The recorder's name when the viewer's RLS allows reading that admin row. */
  recordedByName: string | null;
  /** Whether an admin recorded it at all (false for an online payment). */
  recordedByAdmin: boolean;
};

type DetailRowDb = LedgerRowDb & {
  tax_amount: string | number;
  notes: string | null;
  created_by: string | null;
  recorder: { first_name: string; last_name: string } | null;
};

export async function getPaymentDetail(id: string): Promise<DataResult<PaymentDetail>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("payments")
      .select(
        `${LEDGER_SELECT}, tax_amount, notes, created_by, recorder:admins!payments_created_by_fkey(first_name, last_name)`,
      )
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return { ok: false, error: "Payment not found." };
    const row = data as unknown as DetailRowDb;
    return {
      ok: true,
      data: {
        ...mapLedgerRow(row),
        taxAmountPaise: toPaise(row.tax_amount),
        notes: row.notes,
        recordedByAdmin: row.created_by !== null,
        recordedByName: row.recorder
          ? `${row.recorder.first_name} ${row.recorder.last_name}`.trim()
          : null,
      },
    };
  } catch (error) {
    return fail("Could not load the payment.", error);
  }
}

// ---------------------------------------------------------------------------
// Enrollment lookup for the record form

export async function findEnrollmentIdByCode(
  rawCode: string,
): Promise<DataResult<string | null>> {
  const code = normalizeEnrollmentCode(rawCode);
  if (!code) return { ok: true, data: null };
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("enrollments")
      .select("id")
      .eq("enrollment_code", code)
      .maybeSingle();
    if (error) throw error;
    return { ok: true, data: (data?.id as string | undefined) ?? null };
  } catch (error) {
    return fail("Could not look up the enrollment.", error);
  }
}

// ---------------------------------------------------------------------------
// Record (the single write)

export type RecordedPayment = {
  id: string;
  paymentCode: string;
  alreadyRecorded: boolean;
};

// record_offline_payment() raises these SQLSTATEs; their messages are
// written for an Admin and contain no internal identifiers.
const BUSINESS_RULE_CODES = new Set(["22023", "P2001", "P2002", "P2003"]);

export async function recordOfflinePayment(
  input: RecordOfflinePaymentInput,
): Promise<DataResult<RecordedPayment>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("record_offline_payment", {
      p_payment_id: input.paymentId,
      p_enrollment_id: input.enrollmentId,
      p_amount: input.amount,
      p_method: input.method,
      p_payment_type: input.paymentType,
      p_paid_on: input.paidOn,
      p_reference: input.reference,
      p_notes: input.notes,
    });
    if (error) {
      if (BUSINESS_RULE_CODES.has(error.code)) {
        return { ok: false, error: `${error.message}.`.replace(/\.\.$/, ".") };
      }
      if (error.code === "P2004") return { ok: false, error: "Enrollment not found." };
      if (error.code === "42501") {
        return { ok: false, error: "You are not authorized to record payments." };
      }
      throw error;
    }
    const row = (data ?? [])[0];
    if (!row) throw new Error("record_offline_payment returned no row");
    return {
      ok: true,
      data: {
        id: row.recorded_payment_id,
        paymentCode: row.recorded_payment_code,
        alreadyRecorded: row.already_recorded,
      },
    };
  } catch (error) {
    return fail("The payment could not be recorded.", error);
  }
}
