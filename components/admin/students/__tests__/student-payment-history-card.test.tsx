import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { StudentPaymentHistoryCard } from "@/components/admin/students/student-payment-history-card";
import type { StudentPaymentHistoryRow } from "@/lib/data/students";

const sample: StudentPaymentHistoryRow = {
  id: "1",
  paymentCode: "PAY-000001",
  totalAmount: "20000.00",
  status: "paid",
  method: "upi",
  paidAt: "2026-09-01T00:00:00Z",
  createdAt: "2026-09-01T00:00:00Z",
  enrollmentCode: "ENR-000001",
};

describe("StudentPaymentHistoryCard", () => {
  it("shows the empty state when there is no data", () => {
    render(<StudentPaymentHistoryCard data={[]} />);
    expect(screen.getByText("No payments yet.")).toBeInTheDocument();
  });

  it("renders a safe error state", () => {
    render(<StudentPaymentHistoryCard error="Could not load payment history." />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not load payment history.",
    );
  });

  it("formats the amount as INR, not a raw numeric string", () => {
    render(<StudentPaymentHistoryCard data={[sample]} />);
    expect(screen.getByText(/20,000/)).toBeInTheDocument();
    expect(screen.queryByText("20000.00")).not.toBeInTheDocument();
  });

  it("shows the enrollment code, not a raw enrollment id", () => {
    render(<StudentPaymentHistoryCard data={[sample]} />);
    expect(screen.getByText(/ENR-000001/)).toBeInTheDocument();
  });
});
