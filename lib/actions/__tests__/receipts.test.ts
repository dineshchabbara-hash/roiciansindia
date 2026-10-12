import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({ getCurrentUserContext: vi.fn() }));
vi.mock("@/lib/data/receipts", () => ({ ensureReceiptForPayment: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { generateReceiptAction } from "@/lib/actions/receipts";
import { getCurrentUserContext } from "@/lib/auth/session";
import { ensureReceiptForPayment } from "@/lib/data/receipts";
import { revalidatePath } from "next/cache";

const PAYMENT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

function context(role: "admin" | "super_admin" | "trainer" | "student") {
  return {
    authUserId: `${role}-auth-1`,
    email: `${role}@example.com`,
    role,
    profileId: `${role}-profile-1`,
    displayName: `Test ${role}`,
  };
}

function form(paymentId: string = PAYMENT_ID): FormData {
  const fd = new FormData();
  fd.set("paymentId", paymentId);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("generateReceiptAction", () => {
  it.each([["trainer"], ["student"]] as const)("refuses a %s", async (role) => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(context(role));
    expect(await generateReceiptAction({}, form())).toEqual({
      error: "You are not authorized to generate receipts.",
    });
    expect(ensureReceiptForPayment).not.toHaveBeenCalled();
  });

  it("refuses an unauthenticated request and a malformed payment id", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(null);
    expect((await generateReceiptAction({}, form())).error).toBe(
      "You are not authorized to generate receipts.",
    );
    vi.mocked(getCurrentUserContext).mockResolvedValue(context("admin"));
    expect(await generateReceiptAction({}, form("../../etc"))).toEqual({
      error: "Invalid payment.",
    });
    expect(ensureReceiptForPayment).not.toHaveBeenCalled();
  });

  it.each([["admin"], ["super_admin"]] as const)(
    "%s generates (idempotently) and refreshes the payment page",
    async (role) => {
      vi.mocked(getCurrentUserContext).mockResolvedValue(context(role));
      vi.mocked(ensureReceiptForPayment).mockResolvedValue({
        ok: true,
        data: {
          receiptId: "r1",
          receiptNumber: "REC-2026-000009",
          alreadyIssued: false,
          pdfReady: true,
        },
      });
      expect(await generateReceiptAction({}, form())).toEqual({
        message: "Receipt REC-2026-000009 generated.",
      });
      expect(ensureReceiptForPayment).toHaveBeenCalledExactlyOnceWith(PAYMENT_ID);
      expect(revalidatePath).toHaveBeenCalledWith(`/admin/payments/${PAYMENT_ID}`);
    },
  );

  it("reports an existing receipt as ready and a still-pending PDF as an error", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(context("admin"));
    vi.mocked(ensureReceiptForPayment).mockResolvedValueOnce({
      ok: true,
      data: {
        receiptId: "r1",
        receiptNumber: "REC-2026-000009",
        alreadyIssued: true,
        pdfReady: true,
      },
    });
    expect(await generateReceiptAction({}, form())).toEqual({
      message: "Receipt REC-2026-000009 is ready.",
    });
    vi.mocked(ensureReceiptForPayment).mockResolvedValueOnce({
      ok: true,
      data: {
        receiptId: "r1",
        receiptNumber: "REC-2026-000009",
        alreadyIssued: true,
        pdfReady: false,
      },
    });
    expect((await generateReceiptAction({}, form())).error).toBe(
      "Receipt REC-2026-000009 is issued but its PDF could not be generated. Please try again.",
    );
  });

  it("passes the database's refusal for a non-paid payment through", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(context("admin"));
    vi.mocked(ensureReceiptForPayment).mockResolvedValue({
      ok: false,
      error: "A receipt can only be issued for a paid payment.",
    });
    expect(await generateReceiptAction({}, form())).toEqual({
      error: "A receipt can only be issued for a paid payment.",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
