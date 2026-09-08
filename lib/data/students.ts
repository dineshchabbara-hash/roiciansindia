import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { DataResult } from "@/lib/data/dashboard";
import {
  buildStudentDocumentPath,
  findDuplicateMatches,
  type DuplicateMatch,
} from "@/lib/domain/students";
import type { StudentProfileInput } from "@/lib/validation/students";

const STUDENT_DOCUMENTS_BUCKET = "student-documents";

function fail<T>(context: string, error: unknown): DataResult<T> {
  console.error(`[students data] ${context}:`, error);
  return { ok: false, error: `Could not load ${context}.` };
}

const PAGE_SIZE_DEFAULT = 20;

// ---------------------------------------------------------------------------
// List / search / filter / pagination

export type StudentListRow = {
  id: string;
  studentCode: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string;
  status: "active" | "inactive" | "archived";
  registrationDate: string;
};

export type StudentSearchParams = {
  q?: string;
  status?: "active" | "inactive" | "archived";
  programId?: string;
  batchId?: string;
  page?: number;
  pageSize?: number;
};

export async function searchStudents(params: StudentSearchParams): Promise<
  DataResult<{
    students: StudentListRow[];
    total: number;
    page: number;
    pageSize: number;
  }>
> {
  try {
    const supabase = await createSupabaseServerClient();
    const page = Math.max(1, params.page ?? 1);
    const pageSize = params.pageSize ?? PAGE_SIZE_DEFAULT;

    // Program/batch filtering goes through `enrollments` first, resolving a
    // DISTINCT list of student ids, rather than joining students to
    // enrollments directly — a student with multiple matching enrollments
    // must appear exactly once in the result and count exactly once toward
    // pagination, which a one-to-many join could not guarantee.
    let restrictToIds: string[] | null = null;
    if (params.programId || params.batchId) {
      let enrollmentQuery = supabase.from("enrollments").select("student_id");
      if (params.programId)
        enrollmentQuery = enrollmentQuery.eq("program_id", params.programId);
      if (params.batchId)
        enrollmentQuery = enrollmentQuery.eq("batch_id", params.batchId);

      const { data: enrollmentRows, error: enrollmentError } = await enrollmentQuery;
      if (enrollmentError) throw enrollmentError;

      restrictToIds = Array.from(
        new Set((enrollmentRows ?? []).map((row) => row.student_id)),
      );

      // No enrollments matched at all — short-circuit to an empty page
      // rather than sending an `in ()` filter with an empty list (which
      // PostgREST/Postgres treats inconsistently across drivers).
      if (restrictToIds.length === 0) {
        return { ok: true, data: { students: [], total: 0, page, pageSize } };
      }
    }

    let query = supabase
      .from("students")
      .select(
        "id, student_code, first_name, last_name, email, phone, status, registration_date",
        { count: "exact" },
      );

    if (restrictToIds) query = query.in("id", restrictToIds);
    if (params.status) query = query.eq("status", params.status);
    if (params.q && params.q.trim().length > 0) {
      const q = params.q.trim();
      query = query.or(
        `student_code.ilike.%${q}%,first_name.ilike.%${q}%,last_name.ilike.%${q}%,email.ilike.%${q}%,phone.ilike.%${q}%`,
      );
    }

    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    const { data, error, count } = await query
      .order("created_at", { ascending: false })
      .range(from, to);

    if (error) throw error;

    return {
      ok: true,
      data: {
        students: (data ?? []).map((row) => ({
          id: row.id,
          studentCode: row.student_code,
          firstName: row.first_name,
          lastName: row.last_name,
          email: row.email,
          phone: row.phone,
          status: row.status,
          registrationDate: row.registration_date,
        })),
        total: count ?? 0,
        page,
        pageSize,
      },
    };
  } catch (error) {
    return fail("student list", error);
  }
}

// ---------------------------------------------------------------------------
// Lookup lists for the filter dropdowns (read-only — Program/Batch
// Management itself is out of Phase 5's scope).

export async function getProgramFilterOptions(): Promise<
  DataResult<Array<{ id: string; name: string }>>
> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("programs")
      .select("id, name")
      .order("name");
    if (error) throw error;
    return { ok: true, data: data ?? [] };
  } catch (error) {
    return fail("program list", error);
  }
}

export async function getBatchFilterOptions(): Promise<
  DataResult<Array<{ id: string; name: string }>>
> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("batches")
      .select("id, name")
      .order("name");
    if (error) throw error;
    return { ok: true, data: data ?? [] };
  } catch (error) {
    return fail("batch list", error);
  }
}

// ---------------------------------------------------------------------------
// Profile (core row)

export type StudentProfile = {
  id: string;
  studentCode: string;
  firstName: string;
  lastName: string;
  preferredName: string | null;
  email: string | null;
  phone: string;
  alternatePhone: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  registrationDate: string;
  status: "active" | "inactive" | "archived";
};

export async function getStudentProfile(id: string): Promise<DataResult<StudentProfile>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("students")
      .select(
        "id, student_code, first_name, last_name, preferred_name, email, phone, alternate_phone, date_of_birth, gender, address_line1, address_line2, city, state, postal_code, emergency_contact_name, emergency_contact_phone, registration_date, status",
      )
      .eq("id", id)
      .maybeSingle();

    if (error) throw error;
    if (!data) return { ok: false, error: "Student not found." };

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
        dateOfBirth: data.date_of_birth,
        gender: data.gender,
        addressLine1: data.address_line1,
        addressLine2: data.address_line2,
        city: data.city,
        state: data.state,
        postalCode: data.postal_code,
        emergencyContactName: data.emergency_contact_name,
        emergencyContactPhone: data.emergency_contact_phone,
        registrationDate: data.registration_date,
        status: data.status,
      },
    };
  } catch (error) {
    return fail("student profile", error);
  }
}

// ---------------------------------------------------------------------------
// Enrollment history — from the enrollment_summary view (DATABASE_SCHEMA.md §9)

export type StudentEnrollmentHistoryRow = {
  id: string;
  enrollmentCode: string;
  status: string;
  enrollmentDate: string;
  programName: string;
  batchName: string | null;
  totalPayable: string;
};

export async function getStudentEnrollmentHistory(
  studentId: string,
): Promise<DataResult<StudentEnrollmentHistoryRow[]>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("enrollment_summary")
      .select(
        "id, enrollment_code, enrollment_status, enrollment_date, program_name, batch_name, total_payable",
      )
      .eq("student_id", studentId)
      .order("enrollment_date", { ascending: false });

    if (error) throw error;

    return {
      ok: true,
      data: (data ?? []).map((row) => ({
        id: row.id,
        enrollmentCode: row.enrollment_code,
        status: row.enrollment_status,
        enrollmentDate: row.enrollment_date,
        programName: row.program_name,
        batchName: row.batch_name,
        totalPayable: row.total_payable,
      })),
    };
  } catch (error) {
    return fail("enrollment history", error);
  }
}

// ---------------------------------------------------------------------------
// Payment history — payments belong to enrollments, not directly to a
// student (BR-5: a payment against one enrollment must never affect
// another). Resolve this student's enrollment ids first, then fetch
// payments through that relationship, rather than filtering on the
// denormalized payments.student_id column.

export type StudentPaymentHistoryRow = {
  id: string;
  paymentCode: string;
  totalAmount: string;
  status: string;
  method: string;
  paidAt: string | null;
  createdAt: string;
  enrollmentCode: string;
};

export async function getStudentPaymentHistory(
  studentId: string,
): Promise<DataResult<StudentPaymentHistoryRow[]>> {
  try {
    const supabase = await createSupabaseServerClient();

    const { data: enrollments, error: enrollmentError } = await supabase
      .from("enrollments")
      .select("id, enrollment_code")
      .eq("student_id", studentId);

    if (enrollmentError) throw enrollmentError;
    if (!enrollments || enrollments.length === 0) {
      return { ok: true, data: [] };
    }

    const enrollmentCodeById = new Map(enrollments.map((e) => [e.id, e.enrollment_code]));

    const { data: payments, error: paymentsError } = await supabase
      .from("payments")
      .select(
        "id, payment_code, total_amount, status, method, paid_at, created_at, enrollment_id",
      )
      .in(
        "enrollment_id",
        enrollments.map((e) => e.id),
      )
      .order("created_at", { ascending: false });

    if (paymentsError) throw paymentsError;

    return {
      ok: true,
      data: (payments ?? []).map((row) => ({
        id: row.id,
        paymentCode: row.payment_code,
        totalAmount: row.total_amount,
        status: row.status,
        method: row.method,
        paidAt: row.paid_at,
        createdAt: row.created_at,
        enrollmentCode: enrollmentCodeById.get(row.enrollment_id) ?? "—",
      })),
    };
  } catch (error) {
    return fail("payment history", error);
  }
}

// ---------------------------------------------------------------------------
// Attendance history — from the student_attendance_summary view, one row
// per enrollment (a student with multiple enrollments/batches gets one
// summary row per batch, which is correct — attendance is batch-scoped).

export type StudentAttendanceHistoryRow = {
  enrollmentId: string;
  batchId: string;
  batchName: string | null;
  totalSessions: number;
  presentCount: number;
  absentCount: number;
  lateCount: number;
  excusedCount: number;
  attendancePercentage: number | null;
};

export async function getStudentAttendanceHistory(
  studentId: string,
): Promise<DataResult<StudentAttendanceHistoryRow[]>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("student_attendance_summary")
      .select(
        "enrollment_id, batch_id, total_sessions, present_count, absent_count, late_count, excused_count, attendance_percentage",
      )
      .eq("student_id", studentId);

    if (error) throw error;
    if (!data || data.length === 0) return { ok: true, data: [] };

    const batchIds = Array.from(new Set(data.map((row) => row.batch_id)));
    const { data: batches, error: batchesError } = await supabase
      .from("batches")
      .select("id, name")
      .in("id", batchIds);

    if (batchesError) throw batchesError;
    const batchNameById = new Map((batches ?? []).map((b) => [b.id, b.name]));

    return {
      ok: true,
      data: data.map((row) => ({
        enrollmentId: row.enrollment_id,
        batchId: row.batch_id,
        batchName: batchNameById.get(row.batch_id) ?? null,
        totalSessions: row.total_sessions,
        presentCount: row.present_count,
        absentCount: row.absent_count,
        lateCount: row.late_count,
        excusedCount: row.excused_count,
        attendancePercentage: row.attendance_percentage,
      })),
    };
  } catch (error) {
    return fail("attendance history", error);
  }
}

// ---------------------------------------------------------------------------
// Certificate history

export type StudentCertificateHistoryRow = {
  id: string;
  certificateNumber: string;
  programName: string;
  completionDate: string;
  issueDate: string;
  status: "issued" | "revoked";
};

export async function getStudentCertificateHistory(
  studentId: string,
): Promise<DataResult<StudentCertificateHistoryRow[]>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("certificates")
      .select(
        "id, certificate_number, completion_date, issue_date, status, program:programs(name)",
      )
      .eq("student_id", studentId)
      .order("issue_date", { ascending: false });

    if (error) throw error;

    const rows = (data ?? []) as unknown as Array<{
      id: string;
      certificate_number: string;
      completion_date: string;
      issue_date: string;
      status: "issued" | "revoked";
      program: { name: string } | null;
    }>;

    return {
      ok: true,
      data: rows.map((row) => ({
        id: row.id,
        certificateNumber: row.certificate_number,
        programName: row.program?.name ?? "Unknown program",
        completionDate: row.completion_date,
        issueDate: row.issue_date,
        status: row.status,
      })),
    };
  } catch (error) {
    return fail("certificate history", error);
  }
}

// ---------------------------------------------------------------------------
// Notes (staff-only, never shown to the student)

export type StudentNoteRow = {
  id: string;
  note: string;
  createdAt: string;
  createdByName: string;
};

export async function getStudentNotes(
  studentId: string,
): Promise<DataResult<StudentNoteRow[]>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("student_notes")
      .select("id, note, created_at, admin:admins(first_name, last_name)")
      .eq("student_id", studentId)
      .order("created_at", { ascending: false });

    if (error) throw error;

    const rows = (data ?? []) as unknown as Array<{
      id: string;
      note: string;
      created_at: string;
      admin: { first_name: string; last_name: string } | null;
    }>;

    return {
      ok: true,
      data: rows.map((row) => ({
        id: row.id,
        note: row.note,
        createdAt: row.created_at,
        createdByName: row.admin
          ? `${row.admin.first_name} ${row.admin.last_name}`
          : "Unknown",
      })),
    };
  } catch (error) {
    return fail("student notes", error);
  }
}

export async function insertStudentNote(
  studentId: string,
  note: string,
  createdByAdminId: string,
): Promise<DataResult<{ id: string }>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("student_notes")
      .insert({ student_id: studentId, note, created_by: createdByAdminId })
      .select("id")
      .single();

    if (error) throw error;
    return { ok: true, data: { id: data.id } };
  } catch (error) {
    return fail("saving the note", error);
  }
}

// ---------------------------------------------------------------------------
// Documents (metadata only — see the Storage decision in the Phase 5 plan)

export type StudentDocumentRow = {
  id: string;
  documentType: string;
  filePath: string;
  createdAt: string;
};

export async function getStudentDocuments(
  studentId: string,
): Promise<DataResult<StudentDocumentRow[]>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("student_documents")
      .select("id, document_type, file_path, created_at")
      .eq("student_id", studentId)
      .order("created_at", { ascending: false });

    if (error) throw error;

    return {
      ok: true,
      data: (data ?? []).map((row) => ({
        id: row.id,
        documentType: row.document_type,
        filePath: row.file_path,
        createdAt: row.created_at,
      })),
    };
  } catch (error) {
    return fail("student documents", error);
  }
}

/**
 * Uploads a document to the private student-documents bucket, Admin/Super
 * Admin only (Storage RLS: 20260101000018_student_documents_storage.sql).
 * The object path is always built server-side from the verified `studentId`
 * argument and a freshly generated id — the caller-supplied `file.name` only
 * ever contributes a sanitized cosmetic suffix, never the path's authority.
 * Uses the caller's own RLS-scoped session (not the admin/service-role
 * client) — the Storage policy itself is the authorization boundary here.
 */
export async function uploadStudentDocument(
  studentId: string,
  documentType: string,
  file: File,
  uploadedByAdminId: string,
): Promise<DataResult<{ id: string }>> {
  try {
    const supabase = await createSupabaseServerClient();
    const objectId = crypto.randomUUID();
    const path = buildStudentDocumentPath(studentId, objectId, file.name);

    const { error: uploadError } = await supabase.storage
      .from(STUDENT_DOCUMENTS_BUCKET)
      .upload(path, file, { contentType: file.type || undefined });
    if (uploadError) throw uploadError;

    const { data, error: insertError } = await supabase
      .from("student_documents")
      .insert({
        student_id: studentId,
        document_type: documentType,
        file_path: path,
        uploaded_by: uploadedByAdminId,
        uploaded_by_type: "admin",
      })
      .select("id")
      .single();

    if (insertError) {
      // Roll back the orphaned object rather than leaving an unreferenced
      // file with no metadata row pointing at it.
      await supabase.storage.from(STUDENT_DOCUMENTS_BUCKET).remove([path]);
      throw insertError;
    }

    return { ok: true, data: { id: data.id } };
  } catch (error) {
    return fail("uploading the document", error);
  }
}

/**
 * Deletes a document. Re-fetches the `student_documents` row by its own id
 * first and re-verifies it belongs to `studentId` before removing anything —
 * never trusts a caller-supplied file path directly for the delete target.
 */
export async function deleteStudentDocument(
  studentId: string,
  documentId: string,
): Promise<DataResult<null>> {
  try {
    const supabase = await createSupabaseServerClient();

    const { data: doc, error: fetchError } = await supabase
      .from("student_documents")
      .select("id, student_id, file_path")
      .eq("id", documentId)
      .maybeSingle();

    if (fetchError) throw fetchError;
    if (!doc || doc.student_id !== studentId) {
      return { ok: false, error: "Document not found." };
    }

    const { error: storageError } = await supabase.storage
      .from(STUDENT_DOCUMENTS_BUCKET)
      .remove([doc.file_path]);
    if (storageError) throw storageError;

    const { error: deleteError } = await supabase
      .from("student_documents")
      .delete()
      .eq("id", documentId);
    if (deleteError) throw deleteError;

    return { ok: true, data: null };
  } catch (error) {
    return fail("deleting the document", error);
  }
}

// ---------------------------------------------------------------------------
// Duplicate detection

export async function findDuplicateStudents(input: {
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string;
  dateOfBirth: string | null;
}): Promise<DataResult<DuplicateMatch[]>> {
  try {
    const supabase = await createSupabaseServerClient();

    // Coarse, indexable prefilter — a broader net than the exact rules
    // require, since PostgREST can't evaluate the normalized-phone
    // comparison itself. The precise, conservative matching happens in
    // findDuplicateMatches() (lib/domain/students.ts) against this
    // candidate set, so this over-fetching can never produce a false
    // positive shown to the Admin — only extra rows to filter out.
    const phoneDigitsTail = input.phone.replace(/\D/g, "").slice(-7);
    const orParts = [`phone.ilike.%${phoneDigitsTail}%`];
    if (input.email) orParts.push(`email.ilike.${input.email.trim()}`);
    orParts.push(
      `and(first_name.ilike.${input.firstName.trim()},last_name.ilike.${input.lastName.trim()})`,
    );

    const { data, error } = await supabase
      .from("students")
      .select("id, student_code, first_name, last_name, email, phone, date_of_birth")
      .or(orParts.join(","))
      .limit(50);

    if (error) throw error;

    const matches = findDuplicateMatches(
      input,
      (data ?? []).map((row) => ({
        id: row.id,
        studentCode: row.student_code,
        firstName: row.first_name,
        lastName: row.last_name,
        email: row.email,
        phone: row.phone,
        dateOfBirth: row.date_of_birth,
      })),
    );

    return { ok: true, data: matches };
  } catch (error) {
    return fail("duplicate check", error);
  }
}

// ---------------------------------------------------------------------------
// Profile update (RLS-scoped — student_code is never included, backstopped
// by the DB immutability trigger regardless).

export async function updateStudentProfile(
  id: string,
  input: StudentProfileInput,
): Promise<DataResult<null>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase
      .from("students")
      .update({
        first_name: input.firstName,
        last_name: input.lastName,
        preferred_name: input.preferredName ?? null,
        email: input.email ?? null,
        phone: input.phone,
        alternate_phone: input.alternatePhone ?? null,
        date_of_birth: input.dateOfBirth ?? null,
        gender: input.gender ?? null,
        address_line1: input.addressLine1 ?? null,
        address_line2: input.addressLine2 ?? null,
        city: input.city ?? null,
        state: input.state ?? null,
        postal_code: input.postalCode ?? null,
        emergency_contact_name: input.emergencyContactName ?? null,
        emergency_contact_phone: input.emergencyContactPhone ?? null,
      })
      .eq("id", id);

    if (error) throw error;
    return { ok: true, data: null };
  } catch (error) {
    return fail("updating the student", error);
  }
}

// ---------------------------------------------------------------------------
// Creation — uses the service-role client specifically so `student_code`
// can be minted from `student_id_seq` via the column's own DEFAULT
// expression at insert time (see supabase/migrations/20260101000018 —
// DATABASE_SCHEMA.md §3 requires this happen "inside the same transaction
// as the insert", which a DB-side DEFAULT achieves natively; there is no
// PostgREST endpoint for a bare nextval() call, so the value can never be
// client-supplied). The caller's role must already have been re-checked by
// the Server Action before this is called — this function does not itself
// verify authorization, since it deliberately runs with elevated privilege.
export async function createStudentRecord(
  input: StudentProfileInput,
): Promise<DataResult<{ id: string; studentCode: string }>> {
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("students")
      .insert({
        first_name: input.firstName,
        last_name: input.lastName,
        preferred_name: input.preferredName ?? null,
        email: input.email ?? null,
        phone: input.phone,
        alternate_phone: input.alternatePhone ?? null,
        date_of_birth: input.dateOfBirth ?? null,
        gender: input.gender ?? null,
        address_line1: input.addressLine1 ?? null,
        address_line2: input.addressLine2 ?? null,
        city: input.city ?? null,
        state: input.state ?? null,
        postal_code: input.postalCode ?? null,
        emergency_contact_name: input.emergencyContactName ?? null,
        emergency_contact_phone: input.emergencyContactPhone ?? null,
      })
      .select("id, student_code")
      .single();

    if (error) throw error;
    return { ok: true, data: { id: data.id, studentCode: data.student_code } };
  } catch (error) {
    return fail("creating the student", error);
  }
}

export async function updateStudentStatus(
  id: string,
  status: "active" | "inactive" | "archived",
): Promise<DataResult<null>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.from("students").update({ status }).eq("id", id);
    if (error) throw error;
    return { ok: true, data: null };
  } catch (error) {
    return fail("updating student status", error);
  }
}
