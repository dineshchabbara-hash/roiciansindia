import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ConfirmedUnpaidFeesCard } from "@/components/admin/dashboard/confirmed-unpaid-fees-card";

describe("ConfirmedUnpaidFeesCard", () => {
  it("shows a real zero, not a blank, when there is no unpaid balance", () => {
    render(
      <ConfirmedUnpaidFeesCard
        confirmedUnpaidFeesPaise={0}
        confirmedEnrollmentsWithBalance={0}
      />,
    );
    expect(screen.getByText(/₹0|₹\s?0/)).toBeInTheDocument();
    expect(screen.getByText(/across 0 enrollments/)).toBeInTheDocument();
  });

  it("renders a real total and singular/plural enrollment count correctly", () => {
    render(
      <ConfirmedUnpaidFeesCard
        confirmedUnpaidFeesPaise={3000000}
        confirmedEnrollmentsWithBalance={1}
      />,
    );
    expect(screen.getByText(/30,000/)).toBeInTheDocument();
    expect(screen.getByText(/across 1 enrollment$/)).toBeInTheDocument();
  });

  it("renders a safe error state", () => {
    render(
      <ConfirmedUnpaidFeesCard error="Could not load enrollment financial classification summary." />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not load enrollment financial classification summary.",
    );
  });

  // (17) Excludes leads/applicants/cancelled/withdrawn — the label and
  // explanation must say so explicitly.
  it("(17) label and explanation match the implemented calculation", () => {
    render(
      <ConfirmedUnpaidFeesCard
        confirmedUnpaidFeesPaise={0}
        confirmedEnrollmentsWithBalance={0}
      />,
    );
    expect(screen.getByText("Confirmed Unpaid Fees")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Unpaid balances for confirmed enrollments, based on recorded fees, payments and processed refunds. Excludes leads, applicants and records awaiting cancellation/withdrawal settlement.",
      ),
    ).toBeInTheDocument();
  });
});
