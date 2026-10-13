import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/actions/refunds", () => ({
  recordOfflineRefundAction: vi.fn(),
  initiateRazorpayRefundAction: vi.fn(),
  syncRazorpayRefundAction: vi.fn(),
}));

import { PaymentRefundsCard } from "@/components/admin/payments/payment-refunds-card";
import { PaymentLedgerTable } from "@/components/admin/payments/payment-ledger-table";
import { StudentReceiptsCard } from "@/components/student/payments/student-receipts-card";
import {
  initiateRazorpayRefundAction,
  recordOfflineRefundAction,
  syncRazorpayRefundAction,
} from "@/lib/actions/refunds";
import type { RefundRow } from "@/lib/data/refunds";

const PAYMENT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-000000000002";
const REFUND_ID = "aaaaaaaa-bbbb-4ccc-8ddd-000000000001";

const offlinePayment = {
  id: PAYMENT_ID,
  status: "paid",
  method: "cash",
  amountPaise: 1_000_000,
  paidAt: "2026-10-10T05:00:00Z",
};
const razorpayPayment = { ...offlinePayment, method: "razorpay" };

function refund(overrides: Partial<RefundRow> = {}): RefundRow {
  return {
    id: "r-1",
    amountPaise: 200_000,
    status: "processed",
    reason: "Course downgrade",
    reference: "UTR-1",
    refundedOn: "2026-10-12",
    providerRefundId: null,
    createdAt: "2026-10-12T05:00:00Z",
    initiatedByName: "Asha Admin",
    ...overrides,
  };
}

function renderCard(props: Partial<Parameters<typeof PaymentRefundsCard>[0]> = {}) {
  return render(
    <PaymentRefundsCard
      payment={offlinePayment}
      refunds={[]}
      outstandingPaise={0}
      refundId={REFUND_ID}
      today="2026-10-13"
      {...props}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PaymentRefundsCard", () => {
  it("summarizes refunded, in-progress and refundable amounts from the refund ledger", () => {
    renderCard({
      refunds: [
        refund(),
        refund({
          id: "r-2",
          amountPaise: 300_000,
          status: "initiated",
          refundedOn: null,
        }),
        refund({ id: "r-3", amountPaise: 100_000, status: "failed", refundedOn: null }),
      ],
    });
    const summary = document.querySelector(
      'dl[aria-label="Refund summary"]',
    ) as HTMLElement;
    expect(within(summary).getByText("₹10,000.00")).toBeInTheDocument();
    expect(within(summary).getByText("₹2,000.00")).toBeInTheDocument();
    expect(within(summary).getByText("₹3,000.00")).toBeInTheDocument();
    expect(within(summary).getByText("₹5,000.00")).toBeInTheDocument();
    const history = screen.getByRole("table", { name: "Refund history" });
    expect(within(history).getAllByRole("row")).toHaveLength(4);
    expect(within(history).getByText("Refunded")).toBeInTheDocument();
    expect(within(history).getByText("In progress")).toBeInTheDocument();
    expect(within(history).getByText("Failed")).toBeInTheDocument();
  });

  it("offers the offline form with date, reason and reference, and explains a refund is not a fee reduction", () => {
    renderCard();
    const form = screen.getByRole("form", { name: "Refund payment" });
    expect(within(form).getByLabelText("Refund amount (₹)")).toBeInTheDocument();
    const date = within(form).getByLabelText("Refund date") as HTMLInputElement;
    expect(date.value).toBe("2026-10-13");
    expect(date.max).toBe("2026-10-13");
    expect(date.min).toBe("2026-10-10");
    expect(within(form).getByLabelText("Reason")).toBeRequired();
    expect(within(form).getByLabelText("Reference (optional)")).not.toBeRequired();
    expect(form).toHaveTextContent(
      "It does not reduce the student's fee or total payable — the outstanding balance goes up by the refunded amount.",
    );
    expect(
      within(form).getByRole("button", { name: "Record refund" }),
    ).toBeInTheDocument();
    // Only the server-rendered ids are hidden fields.
    const hidden = Array.from(form.querySelectorAll('input[type="hidden"]')).map((i) => [
      i.getAttribute("name"),
      i.getAttribute("value"),
    ]);
    expect(hidden).toEqual([
      ["refundId", REFUND_ID],
      ["paymentId", PAYMENT_ID],
    ]);
  });

  it("previews outstanding before and after the refund as the amount is typed", () => {
    renderCard({ outstandingPaise: 150_000 });
    const form = screen.getByRole("form", { name: "Refund payment" });
    const preview = form.querySelector(
      'dl[aria-label="Outstanding balance"]',
    ) as HTMLElement;
    expect(preview).toHaveAccessibleName("Outstanding balance");
    fireEvent.change(within(form).getByLabelText("Refund amount (₹)"), {
      target: { value: "2000.50" },
    });
    expect(within(preview).getByText("₹1,500.00")).toBeInTheDocument();
    expect(within(preview).getByText("₹3,500.50")).toBeInTheDocument();
  });

  it("offers a Razorpay refund without date or reference and says the balance changes on confirmation", () => {
    renderCard({ payment: razorpayPayment });
    const form = screen.getByRole("form", { name: "Refund payment" });
    expect(within(form).queryByLabelText("Refund date")).not.toBeInTheDocument();
    expect(within(form).queryByLabelText("Reference (optional)")).not.toBeInTheDocument();
    expect(form).toHaveTextContent("once Razorpay confirms the refund.");
    expect(
      within(form).getByText("Outstanding once Razorpay confirms this refund"),
    ).toBeInTheDocument();
    expect(
      within(form).getByRole("button", { name: "Refund via Razorpay" }),
    ).toBeInTheDocument();
  });

  it("submits through the matching action and shows its result", async () => {
    vi.mocked(recordOfflineRefundAction).mockResolvedValue({
      message: "Refund of ₹100 recorded.",
    });
    renderCard();
    const form = screen.getByRole("form", { name: "Refund payment" });
    fireEvent.change(within(form).getByLabelText("Refund amount (₹)"), {
      target: { value: "100" },
    });
    fireEvent.change(within(form).getByLabelText("Reason"), {
      target: { value: "Overcharge" },
    });
    await act(async () => {
      fireEvent.click(within(form).getByRole("button", { name: "Record refund" }));
    });
    await waitFor(() => expect(recordOfflineRefundAction).toHaveBeenCalledTimes(1));
    expect(initiateRazorpayRefundAction).not.toHaveBeenCalled();
    const data = vi.mocked(recordOfflineRefundAction).mock.calls[0][1] as FormData;
    expect(data.get("amount")).toBe("100");
    expect(data.get("reason")).toBe("Overcharge");
    expect(await within(form).findByRole("status")).toHaveTextContent(
      "Refund of ₹100 recorded.",
    );
  });

  it("offers a status check only for an in-progress Razorpay refund", async () => {
    vi.mocked(syncRazorpayRefundAction).mockResolvedValue({
      message: "Razorpay has not confirmed this refund yet.",
    });
    renderCard({
      payment: razorpayPayment,
      refunds: [
        refund({
          status: "initiated",
          refundedOn: null,
          reference: null,
          providerRefundId: "rfnd_1",
        }),
      ],
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Check status with Razorpay" }));
    });
    await waitFor(() => expect(syncRazorpayRefundAction).toHaveBeenCalledTimes(1));
    const data = vi.mocked(syncRazorpayRefundAction).mock.calls[0][1] as FormData;
    expect(data.get("refundId")).toBe("r-1");
    expect(data.get("paymentId")).toBe(PAYMENT_ID);
  });

  it("offers no refund for a fully refunded or non-paid payment", () => {
    const { unmount } = renderCard({
      refunds: [refund({ amountPaise: 1_000_000 })],
    });
    expect(
      screen.queryByRole("form", { name: "Refund payment" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("Nothing left to refund on this payment."),
    ).toBeInTheDocument();
    unmount();
    renderCard({ payment: { ...offlinePayment, status: "authorized" } });
    expect(
      screen.queryByRole("form", { name: "Refund payment" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("Refunds are available only for paid payments."),
    ).toBeInTheDocument();
  });
});

describe("derived refund labels", () => {
  const ledgerRow = {
    id: PAYMENT_ID,
    paymentCode: "PAY-000042",
    paidAt: "2026-10-08T18:30:00+00:00",
    createdAt: "2026-10-09T05:00:00+00:00",
    amountPaise: 1_000_000,
    method: "cash",
    paymentType: "partial",
    status: "paid",
    reference: null,
    enrollmentId: "e1",
    enrollmentCode: "ENR-000012",
    studentId: "s1",
    studentCode: "10042",
    studentName: "Asha Rao",
    programName: "QA Program",
    batchName: null,
  };

  it("labels a paid payment as partially or fully refunded in the ledger (status unchanged)", () => {
    const { rerender } = render(
      <PaymentLedgerTable
        rows={[
          { ...ledgerRow, refunds: [{ amountPaise: 200_000, status: "processed" }] },
        ]}
      />,
    );
    expect(screen.getByText("Paid — Partially Refunded")).toBeInTheDocument();
    rerender(
      <PaymentLedgerTable
        rows={[
          { ...ledgerRow, refunds: [{ amountPaise: 1_000_000, status: "processed" }] },
        ]}
      />,
    );
    expect(screen.getByText("Paid — Fully Refunded")).toBeInTheDocument();
    rerender(
      <PaymentLedgerTable
        rows={[
          { ...ledgerRow, refunds: [{ amountPaise: 200_000, status: "initiated" }] },
        ]}
      />,
    );
    expect(screen.getByText("Paid")).toBeInTheDocument();
  });

  it("shows a Student their own refunds read-only", () => {
    render(
      <StudentReceiptsCard
        rows={[
          {
            paymentId: PAYMENT_ID,
            paymentCode: "PAY-000042",
            paidAt: "2026-10-08T18:30:00+00:00",
            amountPaise: 1_000_000,
            method: "razorpay",
            receipt: null,
            refunds: [
              { amountPaise: 200_000, status: "processed", refundedOn: "2026-10-12" },
              { amountPaise: 100_000, status: "initiated", refundedOn: null },
              { amountPaise: 50_000, status: "failed", refundedOn: null },
            ],
          },
        ]}
      />,
    );
    expect(
      screen.getByText("Refunded ₹2,000.00 · Refund of ₹1,000.00 in progress"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
