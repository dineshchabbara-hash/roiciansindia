import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { BatchTable } from "@/components/admin/batches/batch-table";
import type { BatchListRow } from "@/lib/data/batches";

const sample: BatchListRow = {
  id: "1",
  name: "September 2026 Weekend Batch",
  programId: "program-1",
  programName: "Full Stack Development",
  startDate: "2026-09-01",
  expectedEndDate: "2026-12-01",
  status: "active",
  capacity: 30,
};

describe("BatchTable", () => {
  it("shows an empty state when there are no batches", () => {
    render(<BatchTable batches={[]} />);
    expect(screen.getByText("No batches found.")).toBeInTheDocument();
  });

  it("renders a batch row with a link to its profile, program, dates, and capacity", () => {
    render(<BatchTable batches={[sample]} />);
    const link = screen.getByRole("link", { name: "September 2026 Weekend Batch" });
    expect(link).toHaveAttribute("href", "/admin/batches/1");
    expect(screen.getByText("Full Stack Development")).toBeInTheDocument();
    expect(screen.getByText("2026-09-01")).toBeInTheDocument();
    expect(screen.getByText("2026-12-01")).toBeInTheDocument();
    expect(screen.getByText("30")).toBeInTheDocument();
  });

  it("shows an em-dash for an unset end date and capacity rather than blank", () => {
    render(
      <BatchTable batches={[{ ...sample, expectedEndDate: null, capacity: null }]} />,
    );
    expect(screen.getAllByText("—")).toHaveLength(2);
  });

  it("renders one row per batch, never duplicating rows", () => {
    render(
      <BatchTable
        batches={[sample, { ...sample, id: "2", name: "October 2026 Weekday Batch" }]}
      />,
    );
    expect(screen.getAllByRole("row")).toHaveLength(3); // header + 2 data rows
  });
});
