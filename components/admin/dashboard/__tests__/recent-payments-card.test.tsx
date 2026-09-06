import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { RecentPaymentsCard } from "@/components/admin/dashboard/recent-payments-card";
import type { RecentPayment } from "@/lib/data/dashboard";

const sample: RecentPayment = {
  id: "1",
  paymentCode: "PAY-000001",
  studentName: "Priya Sharma",
  programName: "AI Powered QA / Software Testing",
  totalAmountPaise: 2000000,
  status: "paid",
  paymentDate: "2026-09-06",
};

describe("RecentPaymentsCard", () => {
  it("shows the professional empty state when there is no data", () => {
    render(<RecentPaymentsCard data={[]} />);
    expect(screen.getByText("No recent payments")).toBeInTheDocument();
  });

  it("renders a safe error state", () => {
    render(<RecentPaymentsCard error="Could not load recent payments." />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not load recent payments.",
    );
  });

  it("renders real payment data with a formatted amount, never a raw number", () => {
    render(<RecentPaymentsCard data={[sample]} />);
    expect(screen.getByText("Priya Sharma")).toBeInTheDocument();
    expect(screen.getByText(/20,000/)).toBeInTheDocument();
    expect(screen.getByText("paid")).toBeInTheDocument();
  });
});
