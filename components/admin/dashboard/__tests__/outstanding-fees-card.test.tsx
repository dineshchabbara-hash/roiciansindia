import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { OutstandingFeesCard } from "@/components/admin/dashboard/outstanding-fees-card";

describe("OutstandingFeesCard", () => {
  it("shows a real zero, not a blank, when there is no outstanding balance", () => {
    render(
      <OutstandingFeesCard
        data={{ totalOutstandingPaise: 0, enrollmentsWithBalance: 0 }}
      />,
    );
    expect(screen.getByText(/₹0|₹\s?0/)).toBeInTheDocument();
    expect(screen.getByText(/across 0 enrollments/)).toBeInTheDocument();
  });

  it("renders a safe error state", () => {
    render(<OutstandingFeesCard error="Could not load outstanding fees summary." />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not load outstanding fees summary.",
    );
  });

  it("renders a real outstanding total and singular/plural enrollment count correctly", () => {
    render(
      <OutstandingFeesCard
        data={{ totalOutstandingPaise: 3000000, enrollmentsWithBalance: 1 }}
      />,
    );
    expect(screen.getByText(/30,000/)).toBeInTheDocument();
    expect(screen.getByText(/across 1 enrollment$/)).toBeInTheDocument();
  });
});
