import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/actions/online-payments", () => ({
  createOnlineOrderAction: vi.fn(),
  verifyOnlinePaymentAction: vi.fn(),
}));
vi.mock("@/lib/data/online-payments", () => ({ getMyOnlinePaymentQuote: vi.fn() }));
vi.mock("@/lib/payments/razorpay-config", () => ({ getRazorpayKeys: vi.fn() }));
vi.mock("@/lib/data/company-settings", () => ({
  getCompanyBranding: vi.fn(async () => ({
    companyName: "Roicians Tech",
    legalName: "x",
  })),
}));

import { PayOnlineButtons } from "@/components/student/payments/pay-online-buttons";
import { StudentPayOnlineCard } from "@/components/student/payments/student-pay-online-card";
import {
  createOnlineOrderAction,
  verifyOnlinePaymentAction,
} from "@/lib/actions/online-payments";
import { getMyOnlinePaymentQuote } from "@/lib/data/online-payments";
import { getRazorpayKeys } from "@/lib/payments/razorpay-config";

const ENROLLMENT_ID = "11111111-2222-4333-8444-555555555555";

type Captured = {
  options: Record<string, unknown> & {
    handler: (r: Record<string, string>) => Promise<void>;
    modal: { ondismiss: () => void };
  };
  failed?: () => void;
};

let captured: Captured | null;

beforeEach(() => {
  vi.clearAllMocks();
  captured = null;
  class FakeRazorpay {
    constructor(options: Captured["options"]) {
      captured = { options };
    }
    on(_event: string, handler: () => void) {
      if (captured) captured.failed = handler;
    }
    open() {}
  }
  (window as unknown as { Razorpay: unknown }).Razorpay = FakeRazorpay;
  vi.mocked(createOnlineOrderAction).mockResolvedValue({
    ok: true,
    checkout: {
      keyId: "rzp_test_PUBLICKEY",
      orderId: "order_ABC",
      amountPaise: 200000,
      currency: "INR",
      enrollmentCode: "ENR-000123",
      description: "ENR-000123 — Pay next installment (Installment 2)",
    },
  });
});

afterEach(() => {
  delete (window as unknown as { Razorpay?: unknown }).Razorpay;
});

function renderButtons() {
  return render(
    <PayOnlineButtons
      enrollmentId={ENROLLMENT_ID}
      merchantName="Roicians Tech"
      options={[
        {
          purpose: "next_installment",
          label: "Pay next installment (Installment 2)",
          amountLabel: "₹2,000.00",
        },
        {
          purpose: "full_outstanding",
          label: "Pay full outstanding balance",
          amountLabel: "₹6,000.00",
        },
      ]}
    />,
  );
}

describe("PayOnlineButtons", () => {
  it("shows one button per server-derived option, with its exact amount", () => {
    renderButtons();
    expect(
      screen.getByRole("button", {
        name: "Pay next installment (Installment 2) — ₹2,000.00",
      }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Pay full outstanding balance — ₹6,000.00" }),
    ).toBeEnabled();
  });

  it("sends only the enrollment id and purpose, then opens Checkout with the server's order", async () => {
    renderButtons();
    fireEvent.click(screen.getByRole("button", { name: /Pay next installment/ }));
    await waitFor(() => expect(captured).not.toBeNull());
    expect(createOnlineOrderAction).toHaveBeenCalledWith({
      enrollmentId: ENROLLMENT_ID,
      purpose: "next_installment",
    });
    expect(captured!.options).toMatchObject({
      key: "rzp_test_PUBLICKEY",
      order_id: "order_ABC",
      amount: 200000,
      currency: "INR",
      name: "Roicians Tech",
    });
    expect(JSON.stringify(captured!.options)).not.toMatch(/secret/i);
  });

  it("hands Razorpay's result to the server and shows the confirmed payment", async () => {
    vi.mocked(verifyOnlinePaymentAction).mockResolvedValue({
      status: "paid",
      paymentCode: "PAY-000042",
      enrollmentId: ENROLLMENT_ID,
    });
    renderButtons();
    fireEvent.click(screen.getByRole("button", { name: /Pay full outstanding/ }));
    await waitFor(() => expect(captured).not.toBeNull());
    await act(async () => {
      await captured!.options.handler({
        razorpay_order_id: "order_ABC",
        razorpay_payment_id: "pay_XYZ",
        razorpay_signature: "f".repeat(64),
        extra_field: "ignored",
      });
    });
    expect(verifyOnlinePaymentAction).toHaveBeenCalledWith({
      razorpay_order_id: "order_ABC",
      razorpay_payment_id: "pay_XYZ",
      razorpay_signature: "f".repeat(64),
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "Payment received — PAY-000042. Your balance has been updated.",
    );
  });

  it.each([
    [
      "processing",
      { status: "processing", enrollmentId: ENROLLMENT_ID },
      "being confirmed",
    ],
    ["held", { status: "held", enrollmentId: ENROLLMENT_ID }, "review it"],
  ] as const)(
    "explains a %s result without claiming the balance changed",
    async (_l, result, text) => {
      vi.mocked(verifyOnlinePaymentAction).mockResolvedValue(result);
      renderButtons();
      fireEvent.click(screen.getByRole("button", { name: /Pay full outstanding/ }));
      await waitFor(() => expect(captured).not.toBeNull());
      await act(async () => {
        await captured!.options.handler({
          razorpay_order_id: "order_ABC",
          razorpay_payment_id: "pay_XYZ",
          razorpay_signature: "f".repeat(64),
        });
      });
      expect(screen.getByRole("status")).toHaveTextContent(text);
    },
  );

  it("reports a cancelled Checkout without contacting the server", async () => {
    renderButtons();
    fireEvent.click(screen.getByRole("button", { name: /Pay full outstanding/ }));
    await waitFor(() => expect(captured).not.toBeNull());
    act(() => captured!.options.modal.ondismiss());
    expect(screen.getByRole("status")).toHaveTextContent(
      "Payment cancelled. You have not been charged.",
    );
    expect(verifyOnlinePaymentAction).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Pay full outstanding/ })).toBeEnabled();
  });

  it("reports a failed payment", async () => {
    renderButtons();
    fireEvent.click(screen.getByRole("button", { name: /Pay full outstanding/ }));
    await waitFor(() => expect(captured?.failed).toBeDefined());
    act(() => captured!.failed!());
    expect(screen.getByRole("alert")).toHaveTextContent("The payment did not go through");
    expect(verifyOnlinePaymentAction).not.toHaveBeenCalled();
  });

  it("shows the server's refusal and never opens Checkout", async () => {
    vi.mocked(createOnlineOrderAction).mockResolvedValue({
      ok: false,
      error: "Your balance has changed. Refresh the page and try again.",
    });
    renderButtons();
    fireEvent.click(screen.getByRole("button", { name: /Pay full outstanding/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your balance has changed",
    );
    expect(captured).toBeNull();
  });
});

describe("StudentPayOnlineCard", () => {
  function quote(overrides: Record<string, unknown>) {
    vi.mocked(getMyOnlinePaymentQuote).mockResolvedValue({
      ok: true,
      data: {
        enrollmentId: ENROLLMENT_ID,
        enrollmentCode: "ENR-000123",
        programCode: "QA-01",
        outstandingPaise: 600000,
        eligible: true,
        options: [
          {
            purpose: "full_outstanding",
            amountPaise: 600000,
            installmentId: null,
            label: "Pay full outstanding balance",
          },
        ],
        ...overrides,
      },
    } as never);
  }

  it("offers the server-derived options when online payment is configured", async () => {
    quote({});
    vi.mocked(getRazorpayKeys).mockReturnValue({
      ok: true,
      keys: { keyId: "rzp_test_X", keySecret: "s" },
    });
    render(await StudentPayOnlineCard({ enrollmentId: ENROLLMENT_ID }));
    expect(screen.getByText("Pay online")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Pay full outstanding balance — ₹6,000.00" }),
    ).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain("rzp_test_X");
  });

  it.each([
    [
      "an unconfirmed enrollment",
      { eligible: false, options: [] },
      "once your enrollment is confirmed",
    ],
    [
      "nothing outstanding",
      { outstandingPaise: 0, options: [] },
      "Nothing is outstanding",
    ],
  ])("offers no payment for %s", async (_l, overrides, text) => {
    quote(overrides);
    vi.mocked(getRazorpayKeys).mockReturnValue({
      ok: true,
      keys: { keyId: "rzp_test_X", keySecret: "s" },
    });
    render(await StudentPayOnlineCard({ enrollmentId: ENROLLMENT_ID }));
    expect(screen.getByText(new RegExp(text))).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("says online payment is unavailable when Razorpay is not configured", async () => {
    quote({});
    vi.mocked(getRazorpayKeys).mockReturnValue({ ok: false, reason: "missing" });
    render(await StudentPayOnlineCard({ enrollmentId: ENROLLMENT_ID }));
    expect(screen.getByText(/not available right now/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
