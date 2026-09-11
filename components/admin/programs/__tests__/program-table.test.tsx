import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProgramTable } from "@/components/admin/programs/program-table";
import type { ProgramListRow } from "@/lib/data/programs";

const sample: ProgramListRow = {
  id: "1",
  programCode: "FSD-101",
  name: "Full Stack Development",
  status: "active",
  regularFee: "50000",
  durationValue: 8,
  durationUnit: "weeks",
};

describe("ProgramTable", () => {
  it("shows an empty state when there are no programs", () => {
    render(<ProgramTable programs={[]} />);
    expect(screen.getByText("No programs found.")).toBeInTheDocument();
  });

  it("renders a program row with a link to its profile, code, duration, and formatted fee", () => {
    render(<ProgramTable programs={[sample]} />);
    const link = screen.getByRole("link", { name: "Full Stack Development" });
    expect(link).toHaveAttribute("href", "/admin/programs/1");
    expect(screen.getByText("FSD-101")).toBeInTheDocument();
    expect(screen.getByText("8 weeks")).toBeInTheDocument();
    // formatDecimalAsINR — a whole-number stored fee still shows exactly 2
    // decimal places, e.g. "₹50,000.00", matching the numeric(12,2) column.
    expect(screen.getByText("₹50,000.00")).toBeInTheDocument();
  });

  it("shows an em-dash for an unset duration rather than blank", () => {
    render(
      <ProgramTable
        programs={[{ ...sample, durationValue: null, durationUnit: null }]}
      />,
    );
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  // Regression coverage for the real Phase 7 bug: formatPaiseAsINR's
  // whole-rupee rounding (maximumFractionDigits: 0) silently turned
  // "500.50" into "₹501" here. The list page must show the exact stored
  // cents.
  it("shows exact cents for a fee with a decimal component, never rounding", () => {
    render(<ProgramTable programs={[{ ...sample, regularFee: "500.50" }]} />);
    expect(screen.getByText("₹500.50")).toBeInTheDocument();
    expect(screen.queryByText("₹501")).not.toBeInTheDocument();
  });
});
