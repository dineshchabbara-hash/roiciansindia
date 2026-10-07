import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { DataResult } from "@/lib/data/dashboard";
import { getEnrollmentFinancialSummary } from "@/lib/data/enrollments";
import {
  buildCertificatePath,
  resolveCertificateEligibility,
  CERTIFICATE_SIGNED_URL_EXPIRY_SECONDS,
  type CertificateStatus,
  type CertificateEligibilityResult,
  type PublicCertificateVerification,
} from "@/lib/domain/certificates";

// `lib/pdf/certificate.tsx` is imported dynamically (inside
// issueCertificateRecord/reissueCertificateRecord below), never statically
// at this module's top level. @react-pdf/renderer pulls in yoga-layout,
// whose ESM entry point runs a top-level `await` that instantiates a WASM
// module as soon as the file is evaluated — not merely parsed. A static
// import here would make every caller of ANY function in this module
// (including read-only ones like getCertificatesForEnrollment, used by
// both the Admin and Student enrollment-detail pages) eagerly pull that
// WASM instantiation into Next.js's own build-time "collecting page data"
// step for every route that touches certificates at all, whether or not
// that route ever actually renders a PDF. A dynamic import defers it to
// the one real place it's needed — inside an actual issuance/reissue
// request at runtime — fixing a real latent cost on every platform, not
// only the Windows-specific crash this surfaced it as.
type CertificatePdfModule = typeof import("@/lib/pdf/certificate");
let certificatePdfModulePromise: Promise<CertificatePdfModule> | null = null;
function loadRenderCertificatePdf() {
  certificatePdfModulePromise ??= import("@/lib/pdf/certificate");
  return certificatePdfModulePromise.then((mod) => mod.renderCertificatePdf);
}

export const CERTIFICATES_BUCKET = "certificates";

function fail<T>(message: string, error: unknown): DataResult<T> {
  console.error(`[certificates data] ${message}:`, error);
  return { ok: false, error: message };
}

// ---------------------------------------------------------------------------
// Shared row shape — Admin and Student both read the same columns (RLS,
// certificates_select_admin / _select_own, is what actually scopes the
// rows a given caller can see; this module adds no extra role branching of
// its own, same discipline as lib/data/assignments.ts).

export type CertificateRow = {
  id: string;
  certificateNumber: string;
  enrollmentId: string;
  studentId: string;
  studentName: string;
  programId: string;
  programName: string;
  completionDate: string;
  issueDate: string;
  status: CertificateStatus;
  revokedReason: string | null;
  revokedAt: string | null;
  createdAt: string;
};

type CertificateQueryRow = {
  id: string;
  certificate_number: string;
  enrollment_id: string;
  student_id: string;
  program_id: string;
  completion_date: string;
  issue_date: string;
  status: CertificateStatus;
  revoked_reason: string | null;
  revoked_at: string | null;
  created_at: string;
  student: { first_name: string; last_name: string } | null;
  program: { name: string } | null;
};

const CERTIFICATE_SELECT =
  "id, certificate_number, enrollment_id, student_id, program_id, completion_date, issue_date, status, revoked_reason, revoked_at, created_at, student:students(first_name, last_name), program:programs(name)";

function toCertificateRow(row: CertificateQueryRow): CertificateRow {
  return {
    id: row.id,
    certificateNumber: row.certificate_number,
    enrollmentId: row.enrollment_id,
    studentId: row.student_id,
    studentName: row.student
      ? `${row.student.first_name} ${row.student.last_name}`
      : "Unknown student",
    programId: row.program_id,
    programName: row.program?.name ?? "Unknown program",
    completionDate: row.completion_date,
    issueDate: row.issue_date,
    status: row.status,
    revokedReason: row.revoked_reason,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
  };
}

/**
 * All certificates for one Enrollment — Admin batch/enrollment detail view.
 * RLS (certificates_select_admin) is the real boundary; ordered newest
 * first so a reissued certificate's replacement shows above the original.
 */
export async function getCertificatesForEnrollment(
  enrollmentId: string,
): Promise<DataResult<CertificateRow[]>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("certificates")
      .select(CERTIFICATE_SELECT)
      .eq("enrollment_id", enrollmentId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return {
      ok: true,
      data: ((data ?? []) as unknown as CertificateQueryRow[]).map(toCertificateRow),
    };
  } catch (error) {
    return fail("Could not load certificates.", error);
  }
}

// getCertificatesForEnrollment above is also the Student Portal's own
// per-enrollment read path (no separate "my certificates" function): it
// takes no student_id parameter at all, so certificates_select_own
// (current_student_id()) is what actually scopes the rows a Student
// caller gets back — same "RLS does the scoping, caller re-verifies the
// parent Enrollment is their own first" pattern every other per-enrollment
// Student read in lib/data/student-portal.ts already follows (e.g.
// getMyAttendanceForEnrollment).

// ---------------------------------------------------------------------------
// Eligibility — reads enrollment status + program.certificate_eligible,
// then calls the one authoritative getEnrollmentFinancialSummary for the
// outstanding balance (never recomputed here), and feeds all three into
// lib/domain/certificates.ts's resolveCertificateEligibility. Never trusts
// a UI-supplied eligibility flag — issueCertificateRecord below re-derives
// this itself server-side before minting anything.

export type CertificateEligibilityCheck = CertificateEligibilityResult & {
  enrollmentId: string;
  studentId: string;
  studentName: string;
  programId: string;
  programName: string;
  alreadyIssued: boolean;
};

async function loadEligibilityContext(enrollmentId: string): Promise<
  DataResult<{
    studentId: string;
    studentName: string;
    programId: string;
    programName: string;
    enrollmentStatus: string;
    programCertificateEligible: boolean;
    totalPayable: string;
  }>
> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("enrollments")
    .select(
      "id, student_id, program_id, status, total_payable, student:students(first_name, last_name), program:programs(name, certificate_eligible)",
    )
    .eq("id", enrollmentId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { ok: false, error: "Enrollment not found." };

  const row = data as unknown as {
    id: string;
    student_id: string;
    program_id: string;
    status: string;
    total_payable: string;
    student: { first_name: string; last_name: string } | null;
    program: { name: string; certificate_eligible: boolean } | null;
  };

  return {
    ok: true,
    data: {
      studentId: row.student_id,
      studentName: row.student
        ? `${row.student.first_name} ${row.student.last_name}`
        : "Unknown student",
      programId: row.program_id,
      programName: row.program?.name ?? "Unknown program",
      enrollmentStatus: row.status,
      programCertificateEligible: row.program?.certificate_eligible ?? false,
      totalPayable: row.total_payable,
    },
  };
}

export async function checkCertificateEligibility(
  enrollmentId: string,
): Promise<DataResult<CertificateEligibilityCheck>> {
  try {
    const context = await loadEligibilityContext(enrollmentId);
    if (!context.ok) return context;

    const financial = await getEnrollmentFinancialSummary(
      enrollmentId,
      context.data.totalPayable,
    );
    if (!financial.ok) return financial;

    const existing = await getCertificatesForEnrollment(enrollmentId);
    if (!existing.ok) return existing;

    const eligibility = resolveCertificateEligibility({
      enrollmentStatus: context.data.enrollmentStatus,
      programCertificateEligible: context.data.programCertificateEligible,
      outstandingPaise: financial.data.outstandingPaise,
    });

    return {
      ok: true,
      data: {
        ...eligibility,
        enrollmentId,
        studentId: context.data.studentId,
        studentName: context.data.studentName,
        programId: context.data.programId,
        programName: context.data.programName,
        alreadyIssued: existing.data.some((c) => c.status === "issued"),
      },
    };
  } catch (error) {
    return fail("Could not check certificate eligibility.", error);
  }
}

// ---------------------------------------------------------------------------
// Issuance. Ordering is fixed by pdf_path/certificate_number being NOT NULL
// and immutable (20260101000012) — mint the number, render the PDF with
// that number printed on it, upload, THEN insert the row with both values
// already known (see 20260101000031's header comment for why this cannot
// follow Materials/Assignments' own "insert row first" pattern). If the
// insert fails, the just-uploaded object is removed so no orphan file is
// left behind; if upload fails, the consumed sequence number is simply
// skipped (accepted the same way every other id sequence in this schema
// already tolerates gaps, 20260101000021's own comment).

export async function issueCertificateRecord(input: {
  enrollmentId: string;
  completionDate: string;
}): Promise<DataResult<{ id: string; certificateNumber: string }>> {
  try {
    const supabase = await createSupabaseServerClient();

    const context = await loadEligibilityContext(input.enrollmentId);
    if (!context.ok) return context;

    const financial = await getEnrollmentFinancialSummary(
      input.enrollmentId,
      context.data.totalPayable,
    );
    if (!financial.ok) return financial;

    const eligibility = resolveCertificateEligibility({
      enrollmentStatus: context.data.enrollmentStatus,
      programCertificateEligible: context.data.programCertificateEligible,
      outstandingPaise: financial.data.outstandingPaise,
    });
    if (!eligibility.eligible) {
      return {
        ok: false,
        error:
          eligibility.reasons[0] ?? "This enrollment is not eligible for a certificate.",
      };
    }

    const { data: settings, error: settingsError } = await supabase
      .from("company_settings")
      .select("legal_name, certificate_signatory_name, certificate_signatory_title")
      .eq("singleton", true)
      .maybeSingle();
    if (settingsError) throw settingsError;

    const { data: certificateNumber, error: rpcError } = await supabase.rpc(
      "generate_certificate_number",
    );
    if (rpcError) throw rpcError;
    if (!certificateNumber)
      throw new Error("Certificate number generation returned no value.");

    const issueDate = new Date().toISOString().slice(0, 10);
    const renderCertificatePdf = await loadRenderCertificatePdf();
    const pdfBuffer = await renderCertificatePdf({
      certificateNumber,
      studentName: context.data.studentName,
      programName: context.data.programName,
      completionDate: input.completionDate,
      issueDate,
      companyLegalName: settings?.legal_name ?? "Roicians Tech Pvt. Ltd.",
      signatoryName: settings?.certificate_signatory_name ?? null,
      signatoryTitle: settings?.certificate_signatory_title ?? null,
    });

    const pdfPath = buildCertificatePath(context.data.studentId, certificateNumber);
    const { error: uploadError } = await supabase.storage
      .from(CERTIFICATES_BUCKET)
      .upload(pdfPath, pdfBuffer, { contentType: "application/pdf" });
    if (uploadError) throw uploadError;

    const { data: inserted, error: insertError } = await supabase
      .from("certificates")
      .insert({
        certificate_number: certificateNumber,
        enrollment_id: input.enrollmentId,
        student_id: context.data.studentId,
        program_id: context.data.programId,
        completion_date: input.completionDate,
        issue_date: issueDate,
        status: "issued",
        pdf_path: pdfPath,
      })
      .select("id")
      .single();
    if (insertError) {
      await supabase.storage.from(CERTIFICATES_BUCKET).remove([pdfPath]);
      throw insertError;
    }

    return { ok: true, data: { id: inserted.id as string, certificateNumber } };
  } catch (error) {
    return fail("Could not issue the certificate. Please try again.", error);
  }
}

// ---------------------------------------------------------------------------
// Revocation — standalone (no replacement). Status/revoked_reason/
// revoked_at are the only fields the immutability trigger allows to
// change; a certificate that is already revoked cannot be revoked again
// (the trigger would accept the no-op update, but surfacing a clear error
// here is more honest than a silent success for an action that did
// nothing).

export async function revokeCertificateRecord(input: {
  certificateId: string;
  revokedReason: string | null;
}): Promise<DataResult<null>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: existing, error: fetchError } = await supabase
      .from("certificates")
      .select("id, status")
      .eq("id", input.certificateId)
      .maybeSingle();
    if (fetchError) throw fetchError;
    if (!existing) return { ok: false, error: "Certificate not found." };
    if (existing.status === "revoked") {
      return { ok: false, error: "This certificate is already revoked." };
    }

    const { error } = await supabase
      .from("certificates")
      .update({
        status: "revoked",
        revoked_reason: input.revokedReason,
        revoked_at: new Date().toISOString(),
      })
      .eq("id", input.certificateId);
    if (error) throw error;
    return { ok: true, data: null };
  } catch (error) {
    return fail("Could not revoke the certificate. Please try again.", error);
  }
}

// ---------------------------------------------------------------------------
// Reissue (replace) — mints a new certificate_number/PDF exactly like
// issueCertificateRecord, then commits both the new row and the original's
// revocation as one atomic step via the reissue_certificate() DB function
// (20260101000033) so the two mutations can never partially apply. The
// underlying academic completion event hasn't changed, so eligibility is
// not re-derived here — only a currently 'issued' certificate may be
// reissued (enforced inside the function itself).

export async function reissueCertificateRecord(input: {
  originalCertificateId: string;
  reason: string | null;
}): Promise<DataResult<{ id: string; certificateNumber: string }>> {
  try {
    const supabase = await createSupabaseServerClient();

    const { data: original, error: fetchError } = await supabase
      .from("certificates")
      .select(CERTIFICATE_SELECT)
      .eq("id", input.originalCertificateId)
      .maybeSingle();
    if (fetchError) throw fetchError;
    if (!original) return { ok: false, error: "Certificate not found." };
    const originalRow = toCertificateRow(original as unknown as CertificateQueryRow);
    if (originalRow.status !== "issued") {
      return { ok: false, error: "Only a currently issued certificate can be reissued." };
    }

    const { data: settings, error: settingsError } = await supabase
      .from("company_settings")
      .select("legal_name, certificate_signatory_name, certificate_signatory_title")
      .eq("singleton", true)
      .maybeSingle();
    if (settingsError) throw settingsError;

    const { data: certificateNumber, error: rpcError } = await supabase.rpc(
      "generate_certificate_number",
    );
    if (rpcError) throw rpcError;
    if (!certificateNumber)
      throw new Error("Certificate number generation returned no value.");

    const issueDate = new Date().toISOString().slice(0, 10);
    const renderCertificatePdf = await loadRenderCertificatePdf();
    const pdfBuffer = await renderCertificatePdf({
      certificateNumber,
      studentName: originalRow.studentName,
      programName: originalRow.programName,
      completionDate: originalRow.completionDate,
      issueDate,
      companyLegalName: settings?.legal_name ?? "Roicians Tech Pvt. Ltd.",
      signatoryName: settings?.certificate_signatory_name ?? null,
      signatoryTitle: settings?.certificate_signatory_title ?? null,
    });

    const pdfPath = buildCertificatePath(originalRow.studentId, certificateNumber);
    const { error: uploadError } = await supabase.storage
      .from(CERTIFICATES_BUCKET)
      .upload(pdfPath, pdfBuffer, { contentType: "application/pdf" });
    if (uploadError) throw uploadError;

    const { data: newId, error: reissueError } = await supabase.rpc(
      "reissue_certificate",
      {
        p_original_id: input.originalCertificateId,
        p_new_certificate_number: certificateNumber,
        p_new_pdf_path: pdfPath,
        p_reason: input.reason,
      },
    );
    if (reissueError) {
      await supabase.storage.from(CERTIFICATES_BUCKET).remove([pdfPath]);
      throw reissueError;
    }

    return { ok: true, data: { id: newId as string, certificateNumber } };
  } catch (error) {
    return fail("Could not reissue the certificate. Please try again.", error);
  }
}

// ---------------------------------------------------------------------------
// Signed download — same shape as getAssignmentAttachmentUrl: re-fetch the
// row through the caller's own RLS-scoped session first (certificates_
// select_admin / _select_own), so a certificate the caller cannot see
// never reaches a Storage call at all.

export async function getCertificateDownloadUrl(
  certificateId: string,
): Promise<DataResult<{ url: string }>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: certificate, error: fetchError } = await supabase
      .from("certificates")
      .select("id, pdf_path")
      .eq("id", certificateId)
      .maybeSingle();
    if (fetchError) throw fetchError;
    if (!certificate) return { ok: false, error: "Certificate not found." };

    const { data: signed, error: signError } = await supabase.storage
      .from(CERTIFICATES_BUCKET)
      .createSignedUrl(certificate.pdf_path, CERTIFICATE_SIGNED_URL_EXPIRY_SECONDS);
    if (signError) throw signError;
    if (!signed?.signedUrl)
      return { ok: false, error: "Could not generate a download link." };

    return { ok: true, data: { url: signed.signedUrl } };
  } catch (error) {
    return fail("Could not generate a download link.", error);
  }
}

// ---------------------------------------------------------------------------
// Public verification (FR-101, /verify-certificate). No anon RLS policy
// exists on `certificates` (by design — Admin/own-Student read only,
// 20260101000014) and none is added for this: instead this uses the
// service-role client (lib/supabase/admin.ts's own documented narrow-use
// pattern) with an explicit column allow-list, exactly the minimal field
// set the certificates table's own comment specifies — never select('*'),
// never Trainer identity, never financial data, never an internal uuid.
// Rate limiting is the caller's responsibility (lib/actions/certificates.ts
// via the existing lib/auth/rate-limit.ts, SECURITY_PLAN.md §11).
export async function verifyCertificatePublic(
  certificateNumber: string,
): Promise<DataResult<PublicCertificateVerification | null>> {
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("certificates")
      .select(
        "certificate_number, issue_date, status, student:students(first_name, last_name), program:programs(name)",
      )
      .eq("certificate_number", certificateNumber.trim())
      .maybeSingle();
    if (error) throw error;
    if (!data) return { ok: true, data: null };

    const row = data as unknown as {
      certificate_number: string;
      issue_date: string;
      status: CertificateStatus;
      student: { first_name: string; last_name: string } | null;
      program: { name: string } | null;
    };

    return {
      ok: true,
      data: {
        certificateNumber: row.certificate_number,
        studentName: row.student
          ? `${row.student.first_name} ${row.student.last_name}`
          : "Unknown student",
        programName: row.program?.name ?? "Unknown program",
        issueDate: row.issue_date,
        status: row.status,
      },
    };
  } catch (error) {
    return fail("Could not verify the certificate. Please try again.", error);
  }
}
