import { describe, expect, it } from "vitest";
import {
  resolveCertificateEligibility,
  sanitizeCertificateNumberForStorage,
  buildCertificatePath,
  isCertificateStatus,
} from "@/lib/domain/certificates";

// Five required eligibility test cases (user checkpoint, verbatim) — all
// THREE conditions (completed, program.certificate_eligible, outstanding
// balance = 0) must hold, and eligibility is strictly scoped to the one
// enrollment it is computed for.
describe("resolveCertificateEligibility", () => {
  it("A: completed + certificate_eligible + balance 0 => eligible", () => {
    const result = resolveCertificateEligibility({
      enrollmentStatus: "completed",
      programCertificateEligible: true,
      outstandingPaise: 0,
    });
    expect(result.eligible).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it("B: completed + certificate_eligible + balance > 0 => NOT eligible", () => {
    const result = resolveCertificateEligibility({
      enrollmentStatus: "completed",
      programCertificateEligible: true,
      outstandingPaise: 50000,
    });
    expect(result.eligible).toBe(false);
    expect(result.completedOk).toBe(true);
    expect(result.programEligibleOk).toBe(true);
    expect(result.balanceClearedOk).toBe(false);
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0]).toMatch(/outstanding balance/i);
  });

  it("C: not completed + balance 0 => NOT eligible", () => {
    const result = resolveCertificateEligibility({
      enrollmentStatus: "active",
      programCertificateEligible: true,
      outstandingPaise: 0,
    });
    expect(result.eligible).toBe(false);
    expect(result.completedOk).toBe(false);
    expect(result.reasons[0]).toMatch(/not completed/i);
  });

  it("D: completed + certificate_eligible=false + balance 0 => NOT eligible", () => {
    const result = resolveCertificateEligibility({
      enrollmentStatus: "completed",
      programCertificateEligible: false,
      outstandingPaise: 0,
    });
    expect(result.eligible).toBe(false);
    expect(result.programEligibleOk).toBe(false);
    expect(result.reasons[0]).toMatch(/not configured as certificate-eligible/i);
  });

  it("E: another enrollment's paid status must not make this enrollment eligible — caller never passes a cross-enrollment balance", () => {
    // This module takes only the already-computed outstandingPaise for the
    // ONE enrollment being checked (lib/data/certificates.ts always calls
    // getEnrollmentFinancialSummary scoped to exactly that enrollment_id,
    // never a different one) — feeding in this enrollment's own real
    // (non-zero) balance must still fail, regardless of any other
    // enrollment's paid-in-full status.
    const result = resolveCertificateEligibility({
      enrollmentStatus: "completed",
      programCertificateEligible: true,
      outstandingPaise: 1,
    });
    expect(result.eligible).toBe(false);
    expect(result.balanceClearedOk).toBe(false);
  });

  it("treats a negative (credit) balance as cleared, not owing", () => {
    const result = resolveCertificateEligibility({
      enrollmentStatus: "completed",
      programCertificateEligible: true,
      outstandingPaise: -100,
    });
    expect(result.balanceClearedOk).toBe(true);
    expect(result.eligible).toBe(true);
  });

  it("reports all three failing reasons when none of the conditions hold", () => {
    const result = resolveCertificateEligibility({
      enrollmentStatus: "active",
      programCertificateEligible: false,
      outstandingPaise: 100,
    });
    expect(result.eligible).toBe(false);
    expect(result.reasons).toHaveLength(3);
  });
});

describe("isCertificateStatus", () => {
  it("accepts only the schema's own two statuses", () => {
    expect(isCertificateStatus("issued")).toBe(true);
    expect(isCertificateStatus("revoked")).toBe(true);
    expect(isCertificateStatus("pending")).toBe(false);
    expect(isCertificateStatus(123)).toBe(false);
  });
});

describe("sanitizeCertificateNumberForStorage", () => {
  it("passes through an already-safe certificate number unchanged", () => {
    expect(sanitizeCertificateNumberForStorage("CERT-2026-000001")).toBe("CERT-2026-000001");
  });

  it("replaces unsafe characters with underscores", () => {
    expect(sanitizeCertificateNumberForStorage("CERT/2026/000001")).toBe("CERT_2026_000001");
    expect(sanitizeCertificateNumberForStorage("CERT 2026#1")).toBe("CERT_2026_1");
  });

  it("falls back to a safe default for an empty input", () => {
    expect(sanitizeCertificateNumberForStorage("")).toBe("certificate");
  });

  it("replaces, rather than drops, unsafe characters (never silently empties a non-empty input)", () => {
    expect(sanitizeCertificateNumberForStorage("###")).toBe("___");
  });
});

describe("buildCertificatePath", () => {
  it("builds a deterministic studentId/certificateNumber.pdf path", () => {
    expect(
      buildCertificatePath("11111111-1111-4111-8111-111111111111", "CERT-2026-000001"),
    ).toBe("11111111-1111-4111-8111-111111111111/CERT-2026-000001.pdf");
  });

  it("sanitizes the certificate number within the path", () => {
    expect(buildCertificatePath("student-1", "CERT/2026/000001")).toBe(
      "student-1/CERT_2026_000001.pdf",
    );
  });
});
