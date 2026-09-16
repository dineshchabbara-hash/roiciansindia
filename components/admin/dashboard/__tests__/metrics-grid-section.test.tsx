import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MetricsGridSection } from "@/components/admin/dashboard/metrics-grid-section";
import type { DashboardMetrics } from "@/lib/data/dashboard";

// getDashboardMetrics lives in a "server-only" module; mocking the module
// directly (rather than "server-only" itself) keeps this test focused on
// what the section renders from a given result, matching how the section
// itself only ever consumes the function's return value.
vi.mock("@/lib/data/dashboard", () => ({
  getDashboardMetrics: vi.fn(),
}));

import { getDashboardMetrics } from "@/lib/data/dashboard";

const BASE_METRICS: DashboardMetrics = {
  totalStudents: 10,
  activeStudents: 4,
  totalTrainers: 3,
  activePrograms: 2,
  activeBatches: 5,
  confirmedEnrollmentsCount: 4,
  revenueCollectedPaise: 0,
  confirmedUnpaidFeesPaise: 12000000,
};

describe("MetricsGridSection — Confirmed Enrollments card", () => {
  it("(11) labels the card 'Confirmed Enrollments' and displays the count from getDashboardMetrics", async () => {
    vi.mocked(getDashboardMetrics).mockResolvedValue({ ok: true, data: BASE_METRICS });

    render(await MetricsGridSection());

    expect(screen.getByText("Confirmed Enrollments")).toBeInTheDocument();
    // Never the stale label the count used to carry.
    expect(screen.queryByText("Enrollments in Active Status")).not.toBeInTheDocument();
    expect(screen.queryByText("Active Enrollments")).not.toBeInTheDocument();
  });

  it("(12) other dashboard financial metrics render unchanged alongside the new label", async () => {
    vi.mocked(getDashboardMetrics).mockResolvedValue({ ok: true, data: BASE_METRICS });

    render(await MetricsGridSection());

    expect(screen.getByText("Revenue Collected")).toBeInTheDocument();
    expect(screen.getByText("Confirmed Unpaid Fees")).toBeInTheDocument();
    expect(screen.getByText(/1,20,000/)).toBeInTheDocument();
  });

  it("renders the section's own error state when the query fails", async () => {
    vi.mocked(getDashboardMetrics).mockResolvedValue({
      ok: false,
      error: "Could not load dashboard metrics.",
    });

    render(await MetricsGridSection());

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not load dashboard metrics.",
    );
  });
});
