import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

// lib/actions/payments.ts is a "use server" module importing server-only
// code; Next swaps it for an RPC stub, Vitest does not. Mocked so the
// client form can render (same approach as student-notes-section.test.tsx).
vi.mock("@/lib/actions/payments", () => ({
  recordOfflinePaymentAction: vi.fn(),
}));

import { PaymentLedgerTable } from "@/components/admin/payments/payment-ledger-table";
import { PaymentLedgerFiltersForm } from "@/components/admin/payments/payment-ledger-filters";
import { RecordPaymentForm } from "@/components/admin/payments/record-payment-form";
import { EnrollmentPaymentContext } from "@/components/admin/payments/enrollment-payment-context";
import { formatPaiseExact } from "@/components/admin/payments/payment-amount";
import { parsePaymentLedgerFilters } from "@/lib/domain/payments";
import type { PaymentLedgerRow } from "@/lib/data/payments";
import type { EnrollmentProfile } from "@/lib/data/enrollments";

/**
 * Pins the rendered DOM contract the Phase 20A E2E suite relies on
 * (labelled table, payment-code link, labelled filter and form controls,
 * the enrollment context list) and the ledger's read-only nature.
 * Render-only — no data layer involved.
 */

const PAYMENT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const ENROLLMENT_ID = "11111111-2222-4333-8444-555555555555";

const row: PaymentLedgerRow = {
  id: PAYMENT_ID,
  paymentCode: "PAY-000042",
  paidAt: "2026-10-08T18:30:00+00:00",
  createdAt: "2026-10-09T05:00:00+00:00",
  amountPaise: 250050,
  method: "bank_transfer",
  paymentType: "partial",
  status: "paid",
  reference: "UTR-77",
  enrollmentId: ENROLLMENT_ID,
  enrollmentCode: "ENR-000012",
  studentId: "s1",
  studentCode: "10042",
  studentName: "आशा Rao",
  programName: "QA Program",
  batchName: "Weekend Batch",
};

describe("formatPaiseExact", () => {
  it("keeps paise instead of rounding to whole rupees", () => {
    expect(formatPaiseExact(250050)).toBe("₹2,500.50");
    expect(formatPaiseExact(1)).toBe("₹0.01");
    expect(formatPaiseExact(1234567890)).toBe("₹1,23,45,678.90");
  });
});

describe("PaymentLedgerTable", () => {
  it("renders one labelled row per payment with exact amount and IST payment date", () => {
    render(<PaymentLedgerTable rows={[row]} />);
    const table = screen.getByRole("table", { name: "Payments" });
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((th) => th.textContent),
    ).toEqual([
      "Payment",
      "Payment date",
      "Student",
      "Enrollment",
      "Program / Batch",
      "Amount",
      "Method",
      "Type",
      "Reference",
      "Status",
    ]);
    const cells = within(table).getAllByRole("row")[1].querySelectorAll("td");
    expect(cells[1].textContent).toBe("2026-10-09");
    expect(cells[5].textContent).toBe("₹2,500.50");
    expect(cells[6].textContent).toBe("Bank transfer");
    expect(cells[9].textContent).toBe("Paid");
    expect(screen.getByRole("link", { name: "PAY-000042" })).toHaveAttribute(
      "href",
      `/admin/payments/${PAYMENT_ID}`,
    );
    expect(screen.getByRole("link", { name: "ENR-000012" })).toHaveAttribute(
      "href",
      `/admin/enrollments/${ENROLLMENT_ID}`,
    );
  });

  it("offers no edit or delete control (FR-91)", () => {
    render(<PaymentLedgerTable rows={[row]} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByText(/edit|delete/i)).toBeNull();
  });

  it("shows an empty state", () => {
    render(<PaymentLedgerTable rows={[]} />);
    expect(screen.getByText("No payments match these filters.")).toBeInTheDocument();
  });
});

describe("PaymentLedgerFiltersForm", () => {
  it("is a labelled GET form pre-filled from the parsed URL filters", () => {
    const filters = parsePaymentLedgerFilters({
      q: "ENR-000012",
      method: "upi",
      status: "paid",
      from: "2026-10-01",
      to: "2026-10-09",
    });
    render(<PaymentLedgerFiltersForm filters={filters} />);
    const form = screen.getByRole("form", { name: "Payment filters" });
    expect(form).toHaveAttribute("method", "GET");
    expect(form).toHaveAttribute("action", "/admin/payments");
    expect(screen.getByLabelText("Search")).toHaveValue("ENR-000012");
    expect(screen.getByLabelText("Method")).toHaveValue("upi");
    expect(screen.getByLabelText("Status")).toHaveValue("paid");
    expect(screen.getByLabelText("Payment date from")).toHaveValue("2026-10-01");
    expect(screen.getByLabelText("Payment date to")).toHaveValue("2026-10-09");
  });
});

describe("RecordPaymentForm", () => {
  function renderForm() {
    return render(
      <RecordPaymentForm
        paymentId={PAYMENT_ID}
        enrollmentId={ENROLLMENT_ID}
        today="2026-10-09"
        outstandingLabel="₹28,499.50"
      />,
    );
  }

  it("carries only the server-minted payment id and resolved enrollment id as hidden fields", () => {
    const { container } = renderForm();
    const hidden = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[type="hidden"]'),
    ).map((input) => [input.name, input.value]);
    expect(hidden).toEqual([
      ["paymentId", PAYMENT_ID],
      ["enrollmentId", ENROLLMENT_ID],
    ]);
    const names = Array.from(
      container.querySelectorAll<HTMLInputElement>("input, select, textarea"),
    ).map((el) => el.name);
    for (const forbidden of [
      "studentId",
      "status",
      "taxAmount",
      "paymentCode",
      "createdBy",
    ]) {
      expect(names).not.toContain(forbidden);
    }
  });

  it("offers only offline methods and enrollment-level payment types", () => {
    renderForm();
    const methods = within(screen.getByLabelText("Payment method"))
      .getAllByRole("option")
      .map((o) => (o as HTMLOptionElement).value);
    expect(methods).toEqual(["", "cash", "upi", "bank_transfer", "cheque"]);
    const types = within(screen.getByLabelText("Payment type"))
      .getAllByRole("option")
      .map((o) => (o as HTMLOptionElement).value);
    expect(types).toEqual(["partial", "full", "registration", "other"]);
  });

  it("defaults the date to today and forbids future dates in the picker", () => {
    renderForm();
    const date = screen.getByLabelText("Date received");
    expect(date).toHaveValue("2026-10-09");
    expect(date).toHaveAttribute("max", "2026-10-09");
  });

  it("states the advisory ceiling and the immutability rule", () => {
    renderForm();
    expect(
      screen.getByText(/At most the outstanding balance \(₹28,499\.50\)/),
    ).toBeInTheDocument();
    expect(screen.getByText(/cannot be edited or deleted/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Record payment" })).toBeEnabled();
  });
});

describe("EnrollmentPaymentContext", () => {
  const enrollment = {
    id: ENROLLMENT_ID,
    enrollmentCode: "ENR-000012",
    studentId: "s1",
    studentCode: "10042",
    studentName: "Asha Rao",
    programId: "p1",
    programName: "QA Program",
    programCode: "QA-01",
    batchId: "b1",
    batchName: "Weekend Batch",
    status: "active",
    totalPayable: "50000.00",
  } as EnrollmentProfile;

  it("identifies the learner and enrollment and shows Phase 14 figures to the paisa", () => {
    const { container } = render(
      <EnrollmentPaymentContext
        enrollment={enrollment}
        summary={{
          totalPayablePaise: 5000000,
          totalPaidPaise: 2250075,
          totalRefundedPaise: 100025,
          outstandingPaise: 2849950,
        }}
      />,
    );
    const list = container.querySelector('dl[aria-label="Enrollment being paid"]');
    expect(list).not.toBeNull();
    const pairs = Array.from(list!.querySelectorAll("div")).map((div) => [
      div.querySelector("dt")?.textContent,
      div.querySelector("dd")?.textContent,
    ]);
    expect(pairs).toEqual([
      ["Student", "Asha Rao"],
      ["Student ID", "10042"],
      ["Program", "QA Program (QA-01)"],
      ["Batch", "Weekend Batch"],
      ["Enrollment", "ENR-000012"],
      ["Enrollment status", "active"],
      ["Total payable", "₹50,000.00"],
      ["Already paid", "₹22,500.75"],
      ["Refunded", "₹1,000.25"],
      ["Outstanding", "₹28,499.50"],
    ]);
  });
});
