import { describe, expect, it } from "vitest";
import {
  FINANCIAL_GROUPS,
  REPORT_COLUMNS,
  REPORT_DEFINITIONS,
  REPORT_EXPORT_MAX_ROWS,
  REPORT_KINDS,
  computeEnrollmentFinancialFigures,
  financialGroupStatuses,
  formatPercentage,
  formatRatioPercent,
  formatTimestampAsIstDate,
  humanizeStatus,
  isIsoDate,
  isReportKind,
  paiseToDecimalString,
  parseReportFilters,
  reportExportFileName,
  reportExportHref,
  reportFiltersToParams,
  reportHeaders,
  reportRowCells,
  sanitizeReportSearch,
  sumFinancialRows,
} from "@/lib/domain/reports";
import {
  CANCELLED_OR_WITHDRAWN_ENROLLMENT_STATUSES,
  CONFIRMED_ENROLLMENT_STATUSES,
  PIPELINE_ENROLLMENT_STATUSES,
  computeOutstandingFeesPaise,
} from "@/lib/domain/dashboard-metrics";

const UUID = "11111111-2222-4333-8444-555555555555";

describe("report kinds", () => {
  it("are exactly the five Phase 19 reports", () => {
    expect(REPORT_KINDS).toEqual([
      "students",
      "enrollments",
      "attendance",
      "financial",
      "certificates",
    ]);
  });

  it("rejects anything else", () => {
    expect(isReportKind("students")).toBe(true);
    expect(isReportKind("payments")).toBe(false);
    expect(isReportKind("__proto__")).toBe(false);
    expect(isReportKind(undefined)).toBe(false);
  });

  it("documents a finite export cap", () => {
    expect(REPORT_EXPORT_MAX_ROWS).toBe(5000);
  });

  it("every report has a default sort in its whitelist and a unique tie-breaker", () => {
    for (const kind of REPORT_KINDS) {
      const def = REPORT_DEFINITIONS[kind];
      expect(Object.hasOwn(def.sorts, def.defaultSort)).toBe(true);
      expect(def.tieBreaker.length).toBeGreaterThan(0);
    }
  });
});

describe("parseReportFilters", () => {
  it("returns defaults for an empty query", () => {
    expect(parseReportFilters("students", {})).toEqual({
      q: "",
      status: null,
      programId: null,
      batchId: null,
      from: null,
      to: null,
      below: null,
      group: "confirmed",
      sort: "registered",
      dir: "desc",
      page: 1,
    });
  });

  it("accepts only whitelisted statuses per report", () => {
    expect(parseReportFilters("students", { status: "active" }).status).toBe("active");
    expect(parseReportFilters("students", { status: "on_hold" }).status).toBeNull();
    expect(parseReportFilters("enrollments", { status: "on_hold" }).status).toBe(
      "on_hold",
    );
    expect(parseReportFilters("certificates", { status: "revoked" }).status).toBe(
      "revoked",
    );
    expect(parseReportFilters("certificates", { status: "active" }).status).toBeNull();
    expect(parseReportFilters("attendance", { status: "present" }).status).toBeNull();
  });

  it("accepts only whitelisted sort keys and directions", () => {
    const f = parseReportFilters("enrollments", { sort: "code", dir: "asc" });
    expect(f.sort).toBe("code");
    expect(f.dir).toBe("asc");
    const bad = parseReportFilters("enrollments", {
      sort: "enrollment_code;drop table",
      dir: "sideways",
    });
    expect(bad.sort).toBe("date");
    expect(bad.dir).toBe("desc");
    expect(parseReportFilters("enrollments", { sort: "toString" }).sort).toBe("date");
    expect(parseReportFilters("enrollments", { sort: "__proto__" }).sort).toBe("date");
  });

  it("accepts only UUIDs for program and batch, and only where supported", () => {
    expect(parseReportFilters("students", { programId: UUID }).programId).toBe(UUID);
    expect(
      parseReportFilters("students", { programId: "1 or 1=1" }).programId,
    ).toBeNull();
    expect(parseReportFilters("certificates", { batchId: UUID }).batchId).toBeNull();
    expect(parseReportFilters("certificates", { programId: UUID }).programId).toBe(UUID);
  });

  it("accepts only real calendar dates, and only on reports with a date filter", () => {
    expect(parseReportFilters("students", { from: "2026-02-28" }).from).toBe(
      "2026-02-28",
    );
    expect(parseReportFilters("students", { from: "2026-02-30" }).from).toBeNull();
    expect(parseReportFilters("students", { to: "28/02/2026" }).to).toBeNull();
    expect(parseReportFilters("attendance", { from: "2026-01-01" }).from).toBeNull();
  });

  it("parses page defensively", () => {
    expect(parseReportFilters("students", { page: "3" }).page).toBe(3);
    expect(parseReportFilters("students", { page: "0" }).page).toBe(1);
    expect(parseReportFilters("students", { page: "-2" }).page).toBe(1);
    expect(parseReportFilters("students", { page: "2.5" }).page).toBe(1);
    expect(parseReportFilters("students", { page: "999999" }).page).toBe(10000);
  });

  it("accepts the attendance threshold only as an integer 1–100", () => {
    expect(parseReportFilters("attendance", { below: "75" }).below).toBe(75);
    expect(parseReportFilters("attendance", { below: "0" }).below).toBeNull();
    expect(parseReportFilters("attendance", { below: "101" }).below).toBeNull();
    expect(parseReportFilters("attendance", { below: "7.5" }).below).toBeNull();
    expect(parseReportFilters("students", { below: "75" }).below).toBeNull();
  });

  it("accepts a financial group only on the financial report", () => {
    expect(parseReportFilters("financial", { group: "all" }).group).toBe("all");
    expect(parseReportFilters("financial", { group: "nope" }).group).toBe("confirmed");
    expect(parseReportFilters("enrollments", { group: "all" }).group).toBe("confirmed");
  });

  it("uses the first value of a repeated parameter", () => {
    expect(
      parseReportFilters("students", { status: ["inactive", "active"] }).status,
    ).toBe("inactive");
  });

  it("sanitizes the search term", () => {
    expect(parseReportFilters("students", { q: "  asha),or(id.gt.0  " }).q).toBe(
      "ashaorid.gt.0",
    );
  });
});

describe("sanitizeReportSearch", () => {
  it("strips PostgREST filter syntax", () => {
    expect(sanitizeReportSearch("a,b(c)d'e\"f*g%h:i")).toBe("abcdefghi");
  });

  it("keeps Unicode letters, digits and email/phone punctuation", () => {
    expect(sanitizeReportSearch("आशा")).toBe("आशा");
    expect(sanitizeReportSearch("asha.s+1@example.com")).toBe("asha.s+1@example.com");
    expect(sanitizeReportSearch("ROI-STU-0001")).toBe("ROI-STU-0001");
  });

  it("collapses whitespace and caps the length", () => {
    expect(sanitizeReportSearch("  a    b  ")).toBe("a b");
    expect(sanitizeReportSearch("x".repeat(500))).toHaveLength(100);
  });
});

describe("reportFiltersToParams / export href", () => {
  it("omits defaults and page", () => {
    const filters = parseReportFilters("students", { page: "4" });
    expect(reportFiltersToParams("students", filters)).toEqual({});
    expect(reportExportHref("students", filters)).toBe("/api/exports/students");
  });

  it("round-trips every non-default filter", () => {
    const raw = {
      q: "asha",
      status: "active",
      programId: UUID,
      batchId: UUID,
      from: "2026-01-01",
      to: "2026-12-31",
      sort: "name",
      dir: "asc",
    };
    const filters = parseReportFilters("students", raw);
    const params = reportFiltersToParams("students", filters);
    expect(params).toEqual(raw);
    expect(parseReportFilters("students", params)).toEqual({ ...filters, page: 1 });
  });

  it("carries the financial group when not the default", () => {
    const filters = parseReportFilters("financial", { group: "pipeline" });
    expect(reportExportHref("financial", filters)).toBe(
      "/api/exports/financial?group=pipeline",
    );
  });

  it("names the export file by report and India date", () => {
    expect(reportExportFileName("financial", new Date("2026-10-08T20:00:00Z"))).toBe(
      "financial-report-2026-10-09.csv",
    );
  });
});

describe("formatting helpers", () => {
  it("converts integer paise to an exact decimal string", () => {
    expect(paiseToDecimalString(0)).toBe("0.00");
    expect(paiseToDecimalString(5)).toBe("0.05");
    expect(paiseToDecimalString(123450)).toBe("1234.50");
    expect(paiseToDecimalString(10000000)).toBe("100000.00");
    expect(paiseToDecimalString(-150)).toBe("-1.50");
  });

  it("refuses a non-integer paise value rather than formatting a float", () => {
    expect(() => paiseToDecimalString(10.5)).toThrow();
  });

  it("formats the view's percentage with two decimals", () => {
    expect(formatPercentage(66.67)).toBe("66.67");
    expect(formatPercentage(100)).toBe("100.00");
    expect(formatPercentage("75.5")).toBe("75.50");
    expect(formatPercentage("50")).toBe("50.00");
    expect(formatPercentage(null)).toBe("");
  });

  it("formats a ratio as a half-up two-decimal percentage", () => {
    expect(formatRatioPercent(2, 3)).toBe("66.67");
    expect(formatRatioPercent(1, 3)).toBe("33.33");
    expect(formatRatioPercent(1, 8)).toBe("12.50");
    expect(formatRatioPercent(1, 16)).toBe("6.25");
    expect(formatRatioPercent(1, 32)).toBe("3.13");
    expect(formatRatioPercent(5, 5)).toBe("100.00");
    expect(formatRatioPercent(0, 5)).toBe("0.00");
    expect(formatRatioPercent(1, 0)).toBeNull();
  });

  it("humanizes snake_case statuses", () => {
    expect(humanizeStatus("on_hold")).toBe("On hold");
    expect(humanizeStatus("issued")).toBe("Issued");
  });

  it("formats a timestamp as its India calendar date", () => {
    expect(formatTimestampAsIstDate("2026-03-01T20:00:00Z")).toBe("2026-03-02");
    expect(formatTimestampAsIstDate(null)).toBe("");
  });

  it("validates ISO dates", () => {
    expect(isIsoDate("2024-02-29")).toBe(true);
    expect(isIsoDate("2025-02-29")).toBe(false);
    expect(isIsoDate("2025-1-1")).toBe(false);
  });
});

describe("financial groups reuse the dashboard classification", () => {
  it("maps each group to the dashboard's own status set", () => {
    expect(FINANCIAL_GROUPS).toEqual([
      "confirmed",
      "pipeline",
      "cancelled_withdrawn",
      "all",
    ]);
    expect(financialGroupStatuses("confirmed")).toBe(CONFIRMED_ENROLLMENT_STATUSES);
    expect(financialGroupStatuses("pipeline")).toBe(PIPELINE_ENROLLMENT_STATUSES);
    expect(financialGroupStatuses("cancelled_withdrawn")).toBe(
      CANCELLED_OR_WITHDRAWN_ENROLLMENT_STATUSES,
    );
    expect(financialGroupStatuses("all")).toBeNull();
  });
});

describe("computeEnrollmentFinancialFigures (Phase 14 engine composition)", () => {
  const enrollment = { id: "e1", total_payable: "50000.00" };
  const paid = [
    { enrollment_id: "e1", total_amount: "20000.00" },
    { enrollment_id: "e1", total_amount: 5000.5 },
    { enrollment_id: "e2", total_amount: "99999.00" },
  ];
  const refunds = [
    { enrollment_id: "e1", amount: "1000.25" },
    { enrollment_id: "e2", amount: "5.00" },
  ];

  it("uses only this enrollment's payments and refunds, in integer paise", () => {
    expect(computeEnrollmentFinancialFigures(enrollment, paid, refunds)).toEqual({
      totalPayablePaise: 5000000,
      totalPaidPaise: 2500050,
      totalRefundedPaise: 100025,
      outstandingPaise: 2599975,
    });
  });

  it("matches computeOutstandingFeesPaise for the same single-enrollment slice", () => {
    const own = computeOutstandingFeesPaise(
      [enrollment],
      paid.filter((p) => p.enrollment_id === "e1"),
      refunds.filter((r) => r.enrollment_id === "e1"),
    );
    expect(
      computeEnrollmentFinancialFigures(enrollment, paid, refunds).outstandingPaise,
    ).toBe(own.totalOutstandingPaise);
  });

  it("clamps an overpaid enrollment's outstanding at zero, as the engine does", () => {
    expect(
      computeEnrollmentFinancialFigures(
        { id: "e3", total_payable: "100.00" },
        [{ enrollment_id: "e3", total_amount: "150.00" }],
        [],
      ),
    ).toEqual({
      totalPayablePaise: 10000,
      totalPaidPaise: 15000,
      totalRefundedPaise: 0,
      outstandingPaise: 0,
    });
  });

  it("sums per-row figures for totals", () => {
    expect(
      sumFinancialRows([
        {
          totalPayablePaise: 100,
          totalPaidPaise: 40,
          totalRefundedPaise: 0,
          outstandingPaise: 60,
        },
        {
          totalPayablePaise: 50,
          totalPaidPaise: 50,
          totalRefundedPaise: 10,
          outstandingPaise: 10,
        },
      ]),
    ).toEqual({
      enrollmentCount: 2,
      totalPayablePaise: 150,
      totalPaidPaise: 90,
      totalRefundedPaise: 10,
      outstandingPaise: 70,
    });
  });
});

describe("columns and cells", () => {
  it("every report's cells line up with its headers", () => {
    const samples = {
      students: {
        id: "s",
        studentCode: "ROI-STU-1",
        firstName: "Asha",
        lastName: "Rao",
        email: null,
        phone: "+919876543210",
        status: "active",
        registrationDate: "2026-01-02",
        enrollmentCount: 2,
      },
      enrollments: {
        id: "e",
        enrollmentCode: "ROI-ENR-1",
        enrollmentDate: "2026-01-03",
        status: "on_hold",
        studentCode: "ROI-STU-1",
        studentFirstName: "Asha",
        studentLastName: "Rao",
        programName: "QA",
        batchName: null,
      },
      attendance: {
        enrollmentId: "e",
        batchId: "b",
        enrollmentCode: "ROI-ENR-1",
        studentCode: "ROI-STU-1",
        studentFirstName: "Asha",
        studentLastName: "Rao",
        programName: "QA",
        batchName: "B1",
        totalSessions: 3,
        presentCount: 1,
        lateCount: 1,
        absentCount: 1,
        excusedCount: 0,
        attendancePercentage: 66.67,
      },
      financial: {
        id: "e",
        enrollmentCode: "ROI-ENR-1",
        enrollmentDate: "2026-01-03",
        status: "active",
        studentCode: "ROI-STU-1",
        studentFirstName: "Asha",
        studentLastName: "Rao",
        programName: "QA",
        batchName: "B1",
        totalPayablePaise: 5000000,
        totalPaidPaise: 2000050,
        totalRefundedPaise: 0,
        outstandingPaise: 2999950,
      },
      certificates: {
        id: "c",
        certificateNumber: "ROI-CERT-1",
        status: "revoked",
        issueDate: "2026-02-01",
        completionDate: "2026-01-31",
        revokedAt: "2026-02-03T10:00:00Z",
        studentCode: "ROI-STU-1",
        studentFirstName: "Asha",
        studentLastName: "Rao",
        programName: "QA",
        enrollmentCode: "ROI-ENR-1",
      },
    } as const;

    for (const kind of REPORT_KINDS) {
      expect(reportRowCells(kind, samples[kind] as never)).toHaveLength(
        REPORT_COLUMNS[kind].length,
      );
    }

    expect(reportRowCells("students", samples.students)).toEqual([
      "ROI-STU-1",
      "Asha",
      "Rao",
      "",
      "+919876543210",
      "Active",
      "2026-01-02",
      2,
    ]);
    expect(reportRowCells("enrollments", samples.enrollments)).toEqual([
      "ROI-ENR-1",
      "2026-01-03",
      "On hold",
      "ROI-STU-1",
      "Asha Rao",
      "QA",
      "",
    ]);
    expect(reportRowCells("attendance", samples.attendance).slice(5)).toEqual([
      3,
      1,
      1,
      1,
      0,
      "66.67",
    ]);
    expect(reportRowCells("financial", samples.financial).slice(7)).toEqual([
      "50000.00",
      "20000.50",
      "0.00",
      "29999.50",
    ]);
    expect(reportRowCells("certificates", samples.certificates).slice(0, 5)).toEqual([
      "ROI-CERT-1",
      "Revoked",
      "2026-02-01",
      "2026-01-31",
      "2026-02-03",
    ]);
  });

  it("never exposes storage paths, signed URLs or internal ids as columns", () => {
    for (const kind of REPORT_KINDS) {
      for (const header of reportHeaders(kind)) {
        expect(header.toLowerCase()).not.toMatch(/pdf|path|url|uuid|auth/);
      }
    }
  });

  it("keeps issued and revoked distinct in the certificate status column", () => {
    expect(REPORT_DEFINITIONS.certificates.statuses).toEqual(["issued", "revoked"]);
  });
});
