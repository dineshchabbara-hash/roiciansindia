/**
 * Pure Certificates domain logic — no I/O. Mirrors lib/domain/assignments.ts's
 * own pattern: only values the schema's own CHECK constraints actually allow
 * (certificates.status — supabase/migrations/20260101000009_certificates_
 * leads_notifications.sql), nothing invented.
 */

import { formatPaiseAsINR } from "@/lib/domain/money";

export const CERTIFICATE_STATUSES = ["issued", "revoked"] as const;
export type CertificateStatus = (typeof CERTIFICATE_STATUSES)[number];

export function isCertificateStatus(value: unknown): value is CertificateStatus {
  return (
    typeof value === "string" &&
    (CERTIFICATE_STATUSES as readonly string[]).includes(value)
  );
}

// ---------------------------------------------------------------------------
// Eligibility — checkpoint-approved decision (REQUIREMENTS §17 brief, not an
// inference): ALL THREE conditions must hold —
//   1. enrollment.status = 'completed'
//   2. program.certificate_eligible = true
//   3. enrollment outstanding balance = 0 (never negative-tolerant; a credit
//      balance is not "owing money", so <= 0 counts as cleared)
// The outstanding-balance figure itself is never recomputed here — this
// module only ever receives the already-computed `outstandingPaise` from
// lib/data/enrollments.ts's own getEnrollmentFinancialSummary (the existing
// authoritative FR-31 calculation), per explicit instruction: no new paid/
// cleared boolean, no duplicated financial logic, no reinterpretation of
// FR-31's refund/credit semantics.

export type CertificateEligibilityInput = {
  enrollmentStatus: string;
  programCertificateEligible: boolean;
  outstandingPaise: number;
};

export type CertificateEligibilityResult = {
  eligible: boolean;
  completedOk: boolean;
  programEligibleOk: boolean;
  balanceClearedOk: boolean;
  /** Admin-facing reasons, one per failing condition, empty when eligible. */
  reasons: string[];
};

export function resolveCertificateEligibility(
  input: CertificateEligibilityInput,
): CertificateEligibilityResult {
  const completedOk = input.enrollmentStatus === "completed";
  const programEligibleOk = input.programCertificateEligible;
  const balanceClearedOk = input.outstandingPaise <= 0;

  const reasons: string[] = [];
  if (!completedOk) {
    reasons.push(
      "Certificate cannot be issued because this enrollment is not completed.",
    );
  }
  if (!programEligibleOk) {
    reasons.push(
      "Certificate cannot be issued because this program is not configured as certificate-eligible.",
    );
  }
  if (!balanceClearedOk) {
    reasons.push(
      `Certificate cannot be issued because this enrollment has an outstanding balance of ${formatPaiseAsINR(input.outstandingPaise)}.`,
    );
  }

  return {
    eligible: completedOk && programEligibleOk && balanceClearedOk,
    completedOk,
    programEligibleOk,
    balanceClearedOk,
    reasons,
  };
}

// ---------------------------------------------------------------------------
// Storage path — deterministic, server-generated. The caller never
// supplies or controls the path itself. certificate_number is already a
// DB-generated, unique, immutable value by the time a path is built (see
// 20260101000031's own header comment for why it must be minted before the
// PDF/path exist at all, unlike Materials/Assignments' own "insert row
// first" ordering) — this still runs it through the same character
// allow-list every other Storage path in this codebase uses, defense in
// depth against a future change to the format string ever introducing a
// path-unsafe character.

export function sanitizeCertificateNumberForStorage(certificateNumber: string): string {
  return certificateNumber.replace(/[^a-zA-Z0-9._-]/g, "_") || "certificate";
}

export function buildCertificatePath(
  studentId: string,
  certificateNumber: string,
): string {
  return `${studentId}/${sanitizeCertificateNumberForStorage(certificateNumber)}.pdf`;
}

// ---------------------------------------------------------------------------
// Public verification data shaping — the certificates table's own comment
// is the approved field list (20260101000009): "Public verification
// (/verify-certificate) exposes only certificate_number, student display
// name, program name, issue_date, and status — never the full row." No
// email/phone/address/DOB, no internal uuids, no financial data, no
// Trainer identity, ever.

export type PublicCertificateVerification = {
  certificateNumber: string;
  studentName: string;
  programName: string;
  issueDate: string;
  status: CertificateStatus;
};

// ---------------------------------------------------------------------------
// Signed URL expiry — reusing Phase 15/16's own established engineering
// default (MATERIAL_SIGNED_URL_EXPIRY_SECONDS / ASSIGNMENT_SIGNED_URL_
// EXPIRY_SECONDS), not a business rule, no certificate-specific requirement
// conflicts with it.
export const CERTIFICATE_SIGNED_URL_EXPIRY_SECONDS = 300;
