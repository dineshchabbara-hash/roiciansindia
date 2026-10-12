import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/actions/receipts", () => ({ generateReceiptAction: vi.fn() }));

import { PaymentReceiptCard } from "@/components/admin/payments/payment-receipt-card";
import { generateReceiptAction } from "@/lib/actions/receipts";

const PAYMENT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const READY = {
  id: "r1",
  receiptNumber: "REC-2026-000007",
  issuedAt: "2026-10-12T04:30:00Z",
  pdfGeneratedAt: "2026-10-12T04:31:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PaymentReceiptCard", () => {
  it("shows an issued receipt with its number and a download link to the receipt route", () => {
    render(
      <PaymentReceiptCard paymentId={PAYMENT_ID} paymentStatus="paid" receipt={READY} />,
    );
    expect(screen.getByRole("heading", { name: "Receipt" })).toBeInTheDocument();
    expect(screen.getByText("REC-2026-000007")).toBeInTheDocument();
    expect(screen.getByText("PDF ready")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Download receipt" });
    expect(link).toHaveAttribute("href", `/api/payments/${PAYMENT_ID}/receipt`);
    // Nothing can regenerate or edit an issued, ready receipt.
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("offers a retry for an issued receipt whose PDF is still pending", () => {
    render(
      <PaymentReceiptCard
        paymentId={PAYMENT_ID}
        paymentStatus="paid"
        receipt={{ ...READY, pdfGeneratedAt: null }}
      />,
    );
    expect(screen.getByText("REC-2026-000007")).toBeInTheDocument();
    expect(screen.getByText("PDF not generated yet")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Retry PDF generation" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Download receipt" }),
    ).not.toBeInTheDocument();
  });

  it("offers Generate receipt for a paid payment without one, submitting only the payment id", async () => {
    vi.mocked(generateReceiptAction).mockResolvedValue({
      message: "Receipt REC-2026-000008 generated.",
    });
    render(
      <PaymentReceiptCard paymentId={PAYMENT_ID} paymentStatus="paid" receipt={null} />,
    );
    expect(
      screen.getByText("No receipt has been issued for this payment yet."),
    ).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Generate receipt" }));
    });

    await waitFor(() => expect(generateReceiptAction).toHaveBeenCalledTimes(1));
    const formData = vi.mocked(generateReceiptAction).mock.calls[0][1] as FormData;
    expect([...formData.keys()]).toEqual(["paymentId"]);
    expect(formData.get("paymentId")).toBe(PAYMENT_ID);
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Receipt REC-2026-000008 generated.",
    );
  });

  it("shows the action's error", async () => {
    vi.mocked(generateReceiptAction).mockResolvedValue({
      error: "A receipt can only be issued for a paid payment.",
    });
    render(
      <PaymentReceiptCard paymentId={PAYMENT_ID} paymentStatus="paid" receipt={null} />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Generate receipt" }));
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "A receipt can only be issued for a paid payment.",
    );
  });

  it.each(["pending", "authorized", "failed", "cancelled"])(
    "offers nothing for a %s payment",
    (status) => {
      render(
        <PaymentReceiptCard
          paymentId={PAYMENT_ID}
          paymentStatus={status}
          receipt={null}
        />,
      );
      expect(
        screen.getByText("Receipts are issued only for paid payments."),
      ).toBeInTheDocument();
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
    },
  );

  it("shows a load error", () => {
    render(
      <PaymentReceiptCard
        paymentId={PAYMENT_ID}
        paymentStatus="paid"
        receipt={null}
        loadError="Could not load the receipt."
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load the receipt.");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
