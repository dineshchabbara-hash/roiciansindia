import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

vi.mock("server-only", () => ({}));

import { StudentReceiptsCard } from "@/components/student/payments/student-receipts-card";

const ROWS = [
  {
    paymentId: "aaaaaaaa-bbbb-4ccc-8ddd-000000000001",
    paymentCode: "PAY-000101",
    paidAt: "2026-10-11T20:00:00Z",
    amountPaise: 200000,
    method: "razorpay",
    receipt: {
      id: "r1",
      receiptNumber: "REC-2026-000007",
      issuedAt: "2026-10-12T04:30:00Z",
      pdfGeneratedAt: "2026-10-12T04:31:00Z",
    },
    refunds: [],
  },
  {
    paymentId: "aaaaaaaa-bbbb-4ccc-8ddd-000000000002",
    paymentCode: "PAY-000102",
    paidAt: "2026-10-10T06:00:00Z",
    amountPaise: 50050,
    method: "cash",
    receipt: null,
    refunds: [],
  },
];

describe("StudentReceiptsCard", () => {
  it("lists each paid payment with its receipt and a download link keyed by payment id", () => {
    render(<StudentReceiptsCard rows={ROWS} />);
    const list = screen.getByRole("list", { name: "Payments and receipts" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);

    expect(items[0]).toHaveTextContent("₹2,000.00 · Razorpay (online)");
    expect(items[0]).toHaveTextContent("Receipt REC-2026-000007");
    expect(
      within(items[0]).getByRole("link", { name: "Download receipt for PAY-000101" }),
    ).toHaveAttribute(
      "href",
      "/api/payments/aaaaaaaa-bbbb-4ccc-8ddd-000000000001/receipt",
    );

    expect(items[1]).toHaveTextContent("₹500.50 · Cash");
    expect(items[1]).toHaveTextContent("Receipt being prepared");
    expect(
      within(items[1]).getByRole("link", { name: "Download receipt for PAY-000102" }),
    ).toHaveAttribute(
      "href",
      "/api/payments/aaaaaaaa-bbbb-4ccc-8ddd-000000000002/receipt",
    );
  });

  it("never renders a storage path or internal receipt id", () => {
    const { container } = render(<StudentReceiptsCard rows={ROWS} />);
    expect(container.innerHTML).not.toMatch(/\.pdf|storage|r1"/);
  });

  it("shows an empty state and a load error", () => {
    const { rerender } = render(<StudentReceiptsCard rows={[]} />);
    expect(screen.getByText("No payments recorded yet.")).toBeInTheDocument();
    rerender(<StudentReceiptsCard rows={[]} loadError="Could not load your payments." />);
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load your payments.");
  });
});
