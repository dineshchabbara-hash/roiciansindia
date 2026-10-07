import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Real regression coverage for the Phase 17 reissue/issue failure paths —
 * same reasoning as lib/data/__tests__/students.test.ts's own header
 * comment: mocks only the true I/O boundary (createSupabaseServerClient)
 * plus the PDF-rendering boundary (@react-pdf/renderer is an external
 * library, not I/O, but a reasonable boundary to stub for determinism/
 * speed), so the REAL issueCertificateRecord/reissueCertificateRecord
 * control flow — including the Storage-rollback-on-DB-failure logic this
 * checkpoint specifically asks to verify — actually runs.
 *
 * Added per the Phase 17 pre-migration checkpoint's own explicit request:
 * prove that a reissue whose DB call fails AFTER a successful PDF upload
 * removes exactly that uploaded object (never a prefix/folder, never the
 * original certificate's own PDF) and never touches the original row or
 * creates a replacement row — all from app-code behavior, since the
 * insert+revoke pair only ever happens inside the one atomic
 * reissue_certificate() DB function call.
 */

vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/lib/pdf/certificate", () => ({
  renderCertificatePdf: vi.fn().mockResolvedValue(Buffer.from("fake-pdf-bytes")),
}));

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { renderCertificatePdf } from "@/lib/pdf/certificate";
import {
  issueCertificateRecord,
  reissueCertificateRecord,
} from "@/lib/data/certificates";

const ELIGIBLE_ENROLLMENT_ROW = {
  id: "enr-1",
  student_id: "student-1",
  program_id: "program-1",
  status: "completed",
  total_payable: "0.00",
  student: { first_name: "Jane", last_name: "Doe" },
  program: { name: "Program X", certificate_eligible: true },
};

const ORIGINAL_CERTIFICATE_ROW = {
  id: "cert-original",
  certificate_number: "CERT-2026-000001",
  enrollment_id: "enr-1",
  student_id: "student-1",
  program_id: "program-1",
  completion_date: "2026-01-01",
  issue_date: "2026-01-02",
  status: "issued",
  revoked_reason: null,
  revoked_at: null,
  created_at: "2026-01-02T00:00:00Z",
  student: { first_name: "Jane", last_name: "Doe" },
  program: { name: "Program X" },
};

const COMPANY_SETTINGS_ROW = {
  legal_name: "Roicians Tech Pvt. Ltd.",
  certificate_signatory_name: "Signatory",
  certificate_signatory_title: "Director",
};

type SupabaseMockOptions = {
  enrollmentSelectResult?: { data: unknown; error: unknown };
  certificateSelectResult?: { data: unknown; error: unknown };
  companySettingsResult?: { data: unknown; error: unknown };
  financialPayments?: { data: unknown; error: unknown };
  financialRefunds?: { data: unknown; error: unknown };
  mintedCertificateNumber?: { data: string | null; error: unknown };
  reissueRpcResult?: { data: string | null; error: unknown };
  insertResult?: { data: { id: string } | null; error: unknown };
  storageUploadResult?: { error: unknown };
  storageRemoveResult?: { error: unknown };
};

function mockSupabase(options: SupabaseMockOptions) {
  const storageUpload = vi
    .fn()
    .mockResolvedValue(options.storageUploadResult ?? { error: null });
  const storageRemove = vi
    .fn()
    .mockResolvedValue(options.storageRemoveResult ?? { error: null });

  const rpc = vi.fn((name: string) => {
    if (name === "generate_certificate_number") {
      return Promise.resolve(
        options.mintedCertificateNumber ?? { data: "CERT-2026-000002", error: null },
      );
    }
    if (name === "reissue_certificate") {
      return Promise.resolve(
        options.reissueRpcResult ?? { data: "cert-new", error: null },
      );
    }
    throw new Error(`Unexpected rpc: ${name}`);
  });

  const insertChain = {
    select: vi.fn().mockReturnValue({
      single: vi
        .fn()
        .mockResolvedValue(
          options.insertResult ?? { data: { id: "cert-new" }, error: null },
        ),
    }),
  };

  const from = vi.fn((table: string) => {
    if (table === "enrollments") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: vi.fn().mockResolvedValue(
              options.enrollmentSelectResult ?? {
                data: ELIGIBLE_ENROLLMENT_ROW,
                error: null,
              },
            ),
          }),
        }),
      };
    }
    if (table === "certificates") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: vi.fn().mockResolvedValue(
              options.certificateSelectResult ?? {
                data: ORIGINAL_CERTIFICATE_ROW,
                error: null,
              },
            ),
          }),
          // getCertificatesForEnrollment's own chain (.eq().order()) — only
          // reached by issueCertificateRecord's alreadyIssued check, not by
          // reissueCertificateRecord.
          order: () => Promise.resolve({ data: [], error: null }),
        }),
        insert: vi.fn().mockReturnValue(insertChain),
      };
    }
    if (table === "company_settings") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: vi.fn().mockResolvedValue(
              options.companySettingsResult ?? {
                data: COMPANY_SETTINGS_ROW,
                error: null,
              },
            ),
          }),
        }),
      };
    }
    if (table === "payments") {
      return {
        select: () => ({
          eq: () => ({
            eq: vi
              .fn()
              .mockResolvedValue(options.financialPayments ?? { data: [], error: null }),
          }),
        }),
      };
    }
    if (table === "payment_refunds") {
      return {
        select: () => ({
          eq: () => ({
            eq: vi
              .fn()
              .mockResolvedValue(options.financialRefunds ?? { data: [], error: null }),
          }),
        }),
      };
    }
    throw new Error(`Unexpected from("${table}")`);
  });

  const client = {
    from,
    storage: {
      from: vi.fn().mockReturnValue({ upload: storageUpload, remove: storageRemove }),
    },
    rpc,
  };

  vi.mocked(createSupabaseServerClient).mockResolvedValue(client as never);
  return { from, storageUpload, storageRemove, rpc };
}

beforeEach(() => vi.clearAllMocks());

describe("issueCertificateRecord", () => {
  it("mints a number, renders+uploads the PDF, then inserts the row (A: upload succeeds, happy path)", async () => {
    const { storageUpload, rpc } = mockSupabase({});

    const result = await issueCertificateRecord({
      enrollmentId: "enr-1",
      completionDate: "2026-01-01",
    });

    expect(result).toEqual({
      ok: true,
      data: { id: "cert-new", certificateNumber: "CERT-2026-000002" },
    });
    expect(rpc).toHaveBeenCalledWith("generate_certificate_number");
    expect(storageUpload).toHaveBeenCalledTimes(1);
    expect(renderCertificatePdf).toHaveBeenCalledTimes(1);
  });

  it("removes the exact just-uploaded PDF object when the certificate INSERT fails, leaving no orphan", async () => {
    const { storageUpload, storageRemove } = mockSupabase({
      insertResult: { data: null, error: new Error("insert failed") },
    });

    const result = await issueCertificateRecord({
      enrollmentId: "enr-1",
      completionDate: "2026-01-01",
    });

    expect(result).toEqual({
      ok: false,
      error: "Could not issue the certificate. Please try again.",
    });
    expect(storageUpload).toHaveBeenCalledTimes(1);
    expect(storageRemove).toHaveBeenCalledTimes(1);
    const [removedPaths] = storageRemove.mock.calls[0] as [string[]];
    expect(removedPaths).toEqual(["student-1/CERT-2026-000002.pdf"]);
  });

  it("never uploads or mints a number when the enrollment is not eligible", async () => {
    const { storageUpload, rpc } = mockSupabase({
      enrollmentSelectResult: {
        data: { ...ELIGIBLE_ENROLLMENT_ROW, status: "active" },
        error: null,
      },
    });

    const result = await issueCertificateRecord({
      enrollmentId: "enr-1",
      completionDate: "2026-01-01",
    });

    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
    expect(storageUpload).not.toHaveBeenCalled();
  });
});

describe("reissueCertificateRecord — DB-failure compensation (checkpoint focus)", () => {
  it("B/C/D/E: when reissue_certificate() fails after a successful upload, removes EXACTLY the new object, never touches the original row, and makes no separate insert call", async () => {
    const { storageUpload, storageRemove, from } = mockSupabase({
      reissueRpcResult: { data: null, error: new Error("db transaction failed") },
    });

    const result = await reissueCertificateRecord({
      originalCertificateId: "cert-original",
      reason: "E2E reason",
    });

    // B: the DB transaction failed — surfaced as a controlled error, never thrown.
    expect(result).toEqual({
      ok: false,
      error: "Could not reissue the certificate. Please try again.",
    });

    // A: the new PDF was uploaded before the DB call was ever attempted.
    expect(storageUpload).toHaveBeenCalledTimes(1);

    // C: exactly the new object is removed — never the original's own
    // path (student-1/CERT-2026-000001.pdf), never a prefix/folder.
    expect(storageRemove).toHaveBeenCalledTimes(1);
    const [removedPaths] = storageRemove.mock.calls[0] as [string[]];
    expect(removedPaths).toEqual(["student-1/CERT-2026-000002.pdf"]);
    expect(removedPaths[0]).not.toBe("student-1/CERT-2026-000001.pdf");

    // D/E: app code never issues its own insert/update against
    // `certificates` for reissue — the only mutation path is the single
    // reissue_certificate() RPC call, which failed, so neither the
    // original row's status nor a replacement row was ever touched from
    // here. The only `from("certificates")` call made is the initial
    // read-only fetch of the original row.
    const certificatesCalls = from.mock.calls.filter(
      ([table]) => table === "certificates",
    );
    expect(certificatesCalls).toHaveLength(1);
  });

  it("happy path: uploads the new PDF, calls reissue_certificate() with both paths, and returns the new id", async () => {
    const { storageUpload, rpc } = mockSupabase({});

    const result = await reissueCertificateRecord({
      originalCertificateId: "cert-original",
      reason: "Corrected name",
    });

    expect(result).toEqual({
      ok: true,
      data: { id: "cert-new", certificateNumber: "CERT-2026-000002" },
    });
    expect(storageUpload).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("reissue_certificate", {
      p_original_id: "cert-original",
      p_new_certificate_number: "CERT-2026-000002",
      p_new_pdf_path: "student-1/CERT-2026-000002.pdf",
      p_reason: "Corrected name",
    });
  });

  it("refuses to reissue a certificate that is not currently issued, without minting a number or uploading anything", async () => {
    const { storageUpload, rpc } = mockSupabase({
      certificateSelectResult: {
        data: { ...ORIGINAL_CERTIFICATE_ROW, status: "revoked" },
        error: null,
      },
    });

    const result = await reissueCertificateRecord({
      originalCertificateId: "cert-original",
      reason: null,
    });

    expect(result).toEqual({
      ok: false,
      error: "Only a currently issued certificate can be reissued.",
    });
    expect(rpc).not.toHaveBeenCalled();
    expect(storageUpload).not.toHaveBeenCalled();
  });
});
