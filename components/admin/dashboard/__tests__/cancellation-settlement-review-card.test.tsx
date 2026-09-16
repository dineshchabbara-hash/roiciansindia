import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { CancellationSettlementReviewCard } from "@/components/admin/dashboard/cancellation-settlement-review-card";

describe("CancellationSettlementReviewCard", () => {
  it("shows a real zero, not a blank, when there are no cancelled/withdrawn enrollments", () => {
    render(
      <CancellationSettlementReviewCard
        cancelledOrWithdrawnCount={0}
        cancelledOrWithdrawnOriginalFeePaise={0}
      />,
    );
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.getByText(/₹0|₹\s?0/)).toBeInTheDocument();
  });

  it("renders the count and original recorded fee total", () => {
    render(
      <CancellationSettlementReviewCard
        cancelledOrWithdrawnCount={2}
        cancelledOrWithdrawnOriginalFeePaise={7500000}
      />,
    );
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText(/75,000/)).toBeInTheDocument();
  });

  it("renders a safe error state", () => {
    render(
      <CancellationSettlementReviewCard error="Could not load enrollment financial classification summary." />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not load enrollment financial classification summary.",
    );
  });

  // (17) The card's own title/label must never assert a receivable, loss,
  // refund due, or written-off debt — the description explicitly
  // disclaims all four, and settlement is deferred to a future Phase 14
  // workflow.
  it("(17) title never asserts a receivable, loss, refund, or write-off; description explicitly disclaims all four", () => {
    render(
      <CancellationSettlementReviewCard
        cancelledOrWithdrawnCount={0}
        cancelledOrWithdrawnOriginalFeePaise={0}
      />,
    );
    const title = screen.getByText("Cancellation / Withdrawal — Settlement Review");
    expect(title).toBeInTheDocument();
    expect(title.textContent).not.toMatch(/receivable|loss|refund due|written[- ]off/i);

    expect(
      screen.getByText(
        "Cancelled and withdrawn enrollments, shown for review only. The amount is the original recorded fee — not a receivable, loss, refund due, or written-off debt. Settlement requires an approved Phase 14 workflow.",
      ),
    ).toBeInTheDocument();
  });
});
