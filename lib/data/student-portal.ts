import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { DataResult } from "@/lib/data/dashboard";
import { getEnrollmentFinancialSummary } from "@/lib/data/enrollments";
import type { EnrollmentStatus } from "@/lib/domain/enrollments";
import type { StudentSelfProfileInput } from "@/lib/validation/student-self-profile";

/**
 * Student Portal data-access layer (Phase 10). Deliberately separate from
 * lib/data/students.ts / lib/data/enrollments.ts (the Admin-facing modules)
 * rather than reusing them: those return fields (discount reason, source,
 * notes, audit-oriented data) that are appropriate for an Admin managing the
 * record but not for a Student viewing their own — see the Phase 10 report
 * for the exact projection decision.
 *
 * Every function below resolves "which student" from the caller's own
 * authenticated session (auth.getUser()) and filters by it directly in the
 * query — never from a caller-supplied id. This is deliberate defense in
 * depth alongside this project's RLS (students_select_own/students_update_own
 * on `students`, enrollments_select_own on `enrollments` —
 * supabase/migrations/20260101000014_rls_policies.sql): even if a policy
 * ever had a gap, there is no parameter shape here a caller could use to ask
 * for another student's data.
 */

function fail<T>(message: string, error: unknown): DataResult<T> {
  console.error(`[student-portal data] ${message}:`, error);
  return { ok: false, error: message };
}

export type MyStudentProfile = {
  id: string;
  studentCode: string;
  firstName: string;
  lastName: string;
  preferredName: string | null;
  email: string | null;
  phone: string;
  alternatePhone: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  registrationDate: string;
  status: "active" | "inactive" | "archived";
};

export async function getMyStudentProfile(): Promise<DataResult<MyStudentProfile>> {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "Not signed in." };

    const { data, error } = await supabase
      .from("students")
      .select(
        "id, student_code, first_name, last_name, preferred_name, email, phone, alternate_phone, address_line1, address_line2, city, state, postal_code, registration_date, status",
      )
      .eq("auth_user_id", user.id)
      .maybeSingle();

    if (error) throw error;
    if (!data) return { ok: false, error: "Student profile not found." };

    return {
      ok: true,
      data: {
        id: data.id,
        studentCode: data.student_code,
        firstName: data.first_name,
        lastName: data.last_name,
        preferredName: data.preferred_name,
        email: data.email,
        phone: data.phone,
        alternatePhone: data.alternate_phone,
        addressLine1: data.address_line1,
        addressLine2: data.address_line2,
        city: data.city,
        state: data.state,
        postalCode: data.postal_code,
        registrationDate: data.registration_date,
        status: data.status,
      },
    };
  } catch (error) {
    return fail("Could not load your profile.", error);
  }
}

// Column list is intentionally exactly REQUIREMENTS.md FR-41's allowed set
// (phone, alternate phone, address). Even if this ever received an extra
// field, the database's own prevent_student_self_edit_of_protected_fields
// trigger independently rejects any other column changing on this row, and
// `.eq("auth_user_id", user.id)` below means the update can only ever
// target the caller's own row.
export async function updateMyStudentProfile(
  input: StudentSelfProfileInput,
): Promise<DataResult<null>> {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "Not signed in." };

    const { error } = await supabase
      .from("students")
      .update({
        phone: input.phone,
        alternate_phone: input.alternatePhone ?? null,
        address_line1: input.addressLine1 ?? null,
        address_line2: input.addressLine2 ?? null,
        city: input.city ?? null,
        state: input.state ?? null,
        postal_code: input.postalCode ?? null,
      })
      .eq("auth_user_id", user.id);

    if (error) throw error;
    return { ok: true, data: null };
  } catch (error) {
    return fail("Could not save changes. Please try again.", error);
  }
}

async function resolveMyStudentId(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
): Promise<DataResult<string>> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { data, error } = await supabase
    .from("students")
    .select("id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { ok: false, error: "Student profile not found." };
  return { ok: true, data: data.id };
}

// Safe projection for Student-facing enrollment information
// (REQUIREMENTS.md FR-42, Phase 10 scope): enrollment code, program, batch,
// status, dates, and a payment-status summary (FR-40) — never the fee
// breakdown (regular/agreed/discount/registration/tax), discount reason,
// source, or admin notes that lib/data/enrollments.ts's EnrollmentProfile
// carries for the Admin UI. See the Phase 10 report for this decision.
export type MyEnrollmentRow = {
  id: string;
  enrollmentCode: string;
  programName: string;
  programCode: string;
  batchName: string | null;
  status: EnrollmentStatus;
  enrollmentDate: string;
  totalPayablePaise: number;
  outstandingPaise: number;
};

type EnrollmentJoinRow = {
  id: string;
  enrollment_code: string;
  status: EnrollmentStatus;
  enrollment_date: string;
  total_payable: string;
  program: { name: string; program_code: string } | null;
  batch: { name: string } | null;
};

async function toMyEnrollmentRow(
  row: EnrollmentJoinRow,
): Promise<DataResult<MyEnrollmentRow>> {
  const summary = await getEnrollmentFinancialSummary(row.id, row.total_payable);
  if (!summary.ok) return summary;
  return {
    ok: true,
    data: {
      id: row.id,
      enrollmentCode: row.enrollment_code,
      programName: row.program?.name ?? "Unknown program",
      programCode: row.program?.program_code ?? "—",
      batchName: row.batch?.name ?? null,
      status: row.status,
      enrollmentDate: row.enrollment_date,
      totalPayablePaise: summary.data.totalPayablePaise,
      outstandingPaise: summary.data.outstandingPaise,
    },
  };
}

export async function getMyEnrollments(): Promise<DataResult<MyEnrollmentRow[]>> {
  try {
    const supabase = await createSupabaseServerClient();
    const studentId = await resolveMyStudentId(supabase);
    if (!studentId.ok) return studentId;

    const { data, error } = await supabase
      .from("enrollments")
      .select(
        "id, enrollment_code, status, enrollment_date, total_payable, program:programs(name, program_code), batch:batches(name)",
      )
      .eq("student_id", studentId.data)
      .order("enrollment_date", { ascending: false });

    if (error) throw error;

    const rows: MyEnrollmentRow[] = [];
    for (const row of (data ?? []) as unknown as EnrollmentJoinRow[]) {
      const result = await toMyEnrollmentRow(row);
      if (!result.ok) throw new Error(result.error);
      rows.push(result.data);
    }

    return { ok: true, data: rows };
  } catch (error) {
    return fail("Could not load your enrollments.", error);
  }
}

// Deliberately re-checks `student_id` against the caller's own resolved id
// (not just `id`) — this is the exact query a direct-URL/ID-manipulation
// attempt against another student's enrollment must fail against (Phase 10
// DoD, IMPLEMENTATION_PLAN.md). A mismatched id returns the same
// "not found" as a genuinely nonexistent enrollment, never a distinct
// "not yours" response, so this can't be used to probe which enrollment
// ids exist.
export async function getMyEnrollment(
  enrollmentId: string,
): Promise<DataResult<MyEnrollmentRow>> {
  try {
    const supabase = await createSupabaseServerClient();
    const studentId = await resolveMyStudentId(supabase);
    if (!studentId.ok) return studentId;

    const { data, error } = await supabase
      .from("enrollments")
      .select(
        "id, enrollment_code, status, enrollment_date, total_payable, program:programs(name, program_code), batch:batches(name)",
      )
      .eq("id", enrollmentId)
      .eq("student_id", studentId.data)
      .maybeSingle();

    if (error) throw error;
    if (!data) return { ok: false, error: "Enrollment not found." };

    return toMyEnrollmentRow(data as unknown as EnrollmentJoinRow);
  } catch (error) {
    return fail("Could not load this enrollment.", error);
  }
}
