import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ReportTable } from "@/components/admin/reports/report-table";
import { ReportResultSummary } from "@/components/admin/reports/report-result-summary";
import { ReportFiltersForm } from "@/components/admin/reports/report-filters";
import { FinancialTotals } from "@/components/admin/reports/financial-totals";
import { ReportsOverview } from "@/components/admin/reports/reports-overview";
import {
  parseReportFilters,
  reportHeaders,
  reportRowCells,
  type FinancialReportRow,
  type StudentReportRow,
} from "@/lib/domain/reports";

/**
 * Pins the rendered DOM contract the Phase 19 E2E suite relies on (table
 * semantics, the visible row-count text, the Export CSV link and its href,
 * the labelled filter controls) and that the table shows exactly the cells
 * the CSV export writes. Render-only — no data layer involved.
 */

const P1 = "11111111-2222-4333-8444-555555555555";

const studentRow: StudentReportRow = {
  id: "s1",
  studentCode: "ROI-STU-0001",
  firstName: "आशा",
  lastName: "Rao",
  email: null,
  phone: "+919876543210",
  status: "active",
  registrationDate: "2026-01-02",
  enrollmentCount: 2,
};

const financialRow: FinancialReportRow = {
  id: "e1",
  enrollmentCode: "ROI-ENR-0001",
  enrollmentDate: "2026-01-03",
  status: "on_hold",
  studentCode: "ROI-STU-0001",
  studentFirstName: "Asha",
  studentLastName: "Rao",
  programName: "QA",
  batchName: null,
  totalPayablePaise: 5000050,
  totalPaidPaise: 2000000,
  totalRefundedPaise: 50,
  outstandingPaise: 3000100,
};

describe("ReportTable", () => {
  it("renders a captioned table whose headers and cells match the CSV mapping", () => {
    render(<ReportTable kind="students" rows={[studentRow]} />);
    const table = screen.getByRole("table", { name: "Student report" });
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((th) => th.textContent),
    ).toEqual(reportHeaders("students"));

    const [, dataRow] = within(table).getAllByRole("row");
    const cells = within(dataRow)
      .getAllByRole("cell")
      .map((td) => td.textContent);
    const csvCells = reportRowCells("students", studentRow).map((c) =>
      c === "" ? "—" : String(c),
    );
    expect(cells).toEqual(csvCells);
    expect(cells).toEqual([
      "ROI-STU-0001",
      "आशा",
      "Rao",
      "—",
      "+919876543210",
      "Active",
      "2026-01-02",
      "2",
    ]);
  });

  it("shows money with INR formatting but the exact paise of the CSV value", () => {
    render(<ReportTable kind="financial" rows={[financialRow]} />);
    const [, dataRow] = within(screen.getByRole("table")).getAllByRole("row");
    const cells = within(dataRow)
      .getAllByRole("cell")
      .map((td) => td.textContent);
    expect(cells.slice(7)).toEqual(["₹50,000.50", "₹20,000.00", "₹0.50", "₹30,001.00"]);
    expect(reportRowCells("financial", financialRow).slice(7)).toEqual([
      "50000.50",
      "20000.00",
      "0.50",
      "30001.00",
    ]);
    expect(cells[2]).toBe("On hold");
    expect(cells[6]).toBe("—");
  });

  it("shows an empty state instead of an empty table", () => {
    render(<ReportTable kind="certificates" rows={[]} />);
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText("No rows match these filters.")).toBeInTheDocument();
  });
});

describe("ReportResultSummary", () => {
  it("shows the visible row range and total, and an Export CSV download link", () => {
    render(
      <ReportResultSummary
        total={60}
        page={2}
        pageSize={25}
        rowsOnPage={25}
        exportHref="/api/exports/students?status=active"
      />,
    );
    expect(screen.getByText("Showing 26–50 of 60 rows.")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Export CSV" });
    expect(link).toHaveAttribute("href", "/api/exports/students?status=active");
    expect(link).toHaveAttribute("download");
  });

  it("uses the singular for one row and says 0 rows when empty", () => {
    const { rerender } = render(
      <ReportResultSummary
        total={1}
        page={1}
        pageSize={25}
        rowsOnPage={1}
        exportHref="/x"
      />,
    );
    expect(screen.getByText("Showing 1–1 of 1 row.")).toBeInTheDocument();
    rerender(
      <ReportResultSummary
        total={0}
        page={1}
        pageSize={25}
        rowsOnPage={0}
        exportHref="/x"
      />,
    );
    expect(screen.getByText("0 rows match these filters.")).toBeInTheDocument();
  });

  it("replaces the export link with an explanation above the cap", () => {
    render(
      <ReportResultSummary
        total={5001}
        page={1}
        pageSize={25}
        rowsOnPage={25}
        exportHref="/x"
      />,
    );
    expect(screen.queryByRole("link", { name: "Export CSV" })).toBeNull();
    expect(
      screen.getByText("Export is limited to 5000 rows. Narrow the filters to export."),
    ).toBeInTheDocument();
  });
});

describe("ReportFiltersForm", () => {
  const programs = [{ id: P1, name: "QA" }];
  const batches = [{ id: P1, name: "B1" }];

  it("is a GET form to the report's own path with its current values", () => {
    render(
      <ReportFiltersForm
        kind="students"
        filters={parseReportFilters("students", {
          q: "asha",
          status: "inactive",
          programId: P1,
          from: "2026-01-01",
          sort: "name",
          dir: "asc",
        })}
        programs={programs}
        batches={batches}
      />,
    );
    const form = screen.getByRole("form", { name: "Student report filters" });
    expect(form).toHaveAttribute("method", "GET");
    expect(form).toHaveAttribute("action", "/admin/reports/students");
    expect(screen.getByLabelText("Search")).toHaveValue("asha");
    expect(screen.getByLabelText("Status")).toHaveValue("inactive");
    expect(screen.getByLabelText("Program")).toHaveValue(P1);
    expect(screen.getByLabelText("Batch")).toHaveValue("");
    expect(screen.getByLabelText("Registered from")).toHaveValue("2026-01-01");
    expect(screen.getByLabelText("Sort by")).toHaveValue("name");
    expect(screen.getByLabelText("Order")).toHaveValue("asc");
    expect(screen.getByRole("button", { name: "Apply filters" })).toHaveAttribute(
      "type",
      "submit",
    );
    expect(screen.getByRole("link", { name: "Reset" })).toHaveAttribute(
      "href",
      "/admin/reports/students",
    );
  });

  it("offers only whitelisted sort keys", () => {
    render(
      <ReportFiltersForm
        kind="enrollments"
        filters={parseReportFilters("enrollments", {})}
        programs={programs}
        batches={batches}
      />,
    );
    const options = within(screen.getByLabelText("Sort by"))
      .getAllByRole("option")
      .map((o) => (o as HTMLOptionElement).value);
    expect(options).toEqual(["date", "code", "status", "student"]);
  });

  it("renders only the filters a report supports", () => {
    const { unmount } = render(
      <ReportFiltersForm
        kind="attendance"
        filters={parseReportFilters("attendance", { below: "75" })}
        programs={programs}
        batches={batches}
      />,
    );
    expect(screen.queryByLabelText("Status")).toBeNull();
    expect(screen.queryByLabelText(/from$/)).toBeNull();
    expect(screen.getByLabelText("Attendance below (%)")).toHaveValue(75);
    unmount();

    render(
      <ReportFiltersForm
        kind="financial"
        filters={parseReportFilters("financial", { group: "pipeline" })}
        programs={programs}
        batches={batches}
      />,
    );
    expect(screen.getByLabelText("Enrollment group")).toHaveValue("pipeline");
    expect(screen.queryByLabelText("Status")).toBeNull();
  });

  it("has no batch filter on the certificate report", () => {
    render(
      <ReportFiltersForm
        kind="certificates"
        filters={parseReportFilters("certificates", {})}
        programs={programs}
        batches={batches}
      />,
    );
    expect(screen.queryByLabelText("Batch")).toBeNull();
    expect(
      within(screen.getByLabelText("Status"))
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["All statuses", "Issued", "Revoked"]);
  });
});

describe("FinancialTotals", () => {
  it("lists every total for the group, without the receivable note for Confirmed", () => {
    render(
      <FinancialTotals
        group="confirmed"
        totals={{
          enrollmentCount: 2,
          totalPayablePaise: 5100050,
          totalPaidPaise: 2600100,
          totalRefundedPaise: 100025,
          outstandingPaise: 2599975,
        }}
      />,
    );
    const region = screen.getByRole("region", {
      name: "Totals for Confirmed (Enrolled, Active, On hold, Completed)",
    });
    const values = within(region)
      .getAllByRole("definition")
      .map((dd) => dd.textContent);
    expect(values).toEqual(["2", "₹51,000.50", "₹26,001.00", "₹1,000.25", "₹25,999.75"]);
    expect(screen.queryByText(/not a receivable/)).toBeNull();
  });

  it("explains that non-confirmed outstanding is not a receivable", () => {
    render(
      <FinancialTotals
        group="pipeline"
        totals={{
          enrollmentCount: 0,
          totalPayablePaise: 0,
          totalPaidPaise: 0,
          totalRefundedPaise: 0,
          outstandingPaise: 0,
        }}
      />,
    );
    expect(screen.getByText(/not a receivable/)).toBeInTheDocument();
  });
});

describe("ReportsOverview", () => {
  it("shows the summary figures and links to all five reports", () => {
    render(
      <ReportsOverview
        data={{
          students: { total: 11, active: 9 },
          enrollments: { confirmed: 6, pipeline: 3, cancelledOrWithdrawn: 2 },
          finance: { revenueCollectedPaise: 1234550, confirmedUnpaidFeesPaise: 0 },
          attendance: { marked: 3, presentOrLate: 2 },
          certificates: { issued: 4, revoked: 1 },
        }}
      />,
    );
    const attendance = screen
      .getByRole("heading", { name: "Attendance", level: 3 })
      .closest("[data-slot=card]") as HTMLElement;
    expect(within(attendance).getByText("66.67%")).toBeInTheDocument();
    expect(screen.getByText("₹12,345.50")).toBeInTheDocument();

    const list = screen.getByRole("heading", { name: "Reports", level: 2 })
      .nextElementSibling as HTMLElement;
    expect(
      within(list)
        .getAllByRole("link")
        .map((a) => [a.textContent, a.getAttribute("href")]),
    ).toEqual([
      ["Student report", "/admin/reports/students"],
      ["Enrollment report", "/admin/reports/enrollments"],
      ["Attendance report", "/admin/reports/attendance"],
      ["Financial report", "/admin/reports/financial"],
      ["Certificate report", "/admin/reports/certificates"],
    ]);
  });

  it("shows an error state per section and a dash when nothing is marked", () => {
    render(
      <ReportsOverview
        data={{
          students: null,
          enrollments: null,
          finance: null,
          attendance: { marked: 0, presentOrLate: 0 },
          certificates: null,
        }}
      />,
    );
    expect(screen.getAllByRole("alert")).toHaveLength(4);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
