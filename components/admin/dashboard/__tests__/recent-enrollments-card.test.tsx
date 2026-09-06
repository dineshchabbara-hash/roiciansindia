import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { RecentEnrollmentsCard } from "@/components/admin/dashboard/recent-enrollments-card";
import type { RecentEnrollment } from "@/lib/data/dashboard";

const sample: RecentEnrollment = {
  id: "1",
  enrollmentCode: "ENR-000001",
  studentName: "Priya Sharma",
  studentCode: "10001",
  programName: "AI Powered QA / Software Testing",
  batchName: "September 2026 Weekend Batch",
  enrollmentDate: "2026-09-06",
  status: "active",
};

describe("RecentEnrollmentsCard", () => {
  it("shows the professional empty state when there is no data", () => {
    render(<RecentEnrollmentsCard data={[]} />);
    expect(screen.getByText("No recent enrollments")).toBeInTheDocument();
  });

  it("renders a safe error state and never the raw error alongside data", () => {
    render(<RecentEnrollmentsCard error="Could not load recent enrollments." />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not load recent enrollments.",
    );
    expect(screen.queryByText("No recent enrollments")).not.toBeInTheDocument();
  });

  it("renders real enrollment data when present", () => {
    render(<RecentEnrollmentsCard data={[sample]} />);
    expect(screen.getByText("Priya Sharma")).toBeInTheDocument();
    expect(screen.getByText(/AI Powered QA/)).toBeInTheDocument();
    expect(screen.getByText("active")).toBeInTheDocument();
  });
});
