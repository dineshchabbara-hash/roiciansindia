import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({ getCurrentUserContext: vi.fn() }));
vi.mock("@/lib/auth/rate-limit", () => ({ checkRateLimit: vi.fn() }));
vi.mock("@/lib/data/online-payments", () => ({
  createMyOnlineOrder: vi.fn(),
  verifyMyCheckout: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
  createOnlineOrderAction,
  verifyOnlinePaymentAction,
} from "@/lib/actions/online-payments";
import { getCurrentUserContext } from "@/lib/auth/session";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import { createMyOnlineOrder, verifyMyCheckout } from "@/lib/data/online-payments";
import { revalidatePath } from "next/cache";

const ENROLLMENT_ID = "11111111-2222-4333-8444-555555555555";

function context(role: "admin" | "super_admin" | "trainer" | "student") {
  return {
    authUserId: `${role}-auth`,
    email: `${role}@example.com`,
    role,
    profileId: `${role}-profile`,
    displayName: role,
  };
}

const validCheckout = {
  razorpay_order_id: "order_ABC123",
  razorpay_payment_id: "pay_DEF456",
  razorpay_signature: "a".repeat(64),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
});

describe("createOnlineOrderAction", () => {
  it.each([["admin"], ["super_admin"], ["trainer"]] as const)(
    "refuses a %s (Students only initiate online payment)",
    async (role) => {
      vi.mocked(getCurrentUserContext).mockResolvedValue(context(role));
      const result = await createOnlineOrderAction({
        enrollmentId: ENROLLMENT_ID,
        purpose: "full_outstanding",
      });
      expect(result).toEqual({
        ok: false,
        error: "Online payment is available to students only.",
      });
      expect(createMyOnlineOrder).not.toHaveBeenCalled();
    },
  );

  it("refuses an anonymous caller", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(null);
    expect(
      (
        await createOnlineOrderAction({
          enrollmentId: ENROLLMENT_ID,
          purpose: "full_outstanding",
        })
      ).ok,
    ).toBe(false);
    expect(createMyOnlineOrder).not.toHaveBeenCalled();
  });

  it("uses the session's student id and ignores any amount or student in the request", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(context("student"));
    vi.mocked(createMyOnlineOrder).mockResolvedValue({
      ok: true,
      data: {
        keyId: "rzp_test_X1",
        orderId: "order_1",
        amountPaise: 100,
        currency: "INR",
        enrollmentCode: "ENR-1",
        description: "d",
      },
    });
    const tampered = {
      enrollmentId: ENROLLMENT_ID,
      purpose: "full_outstanding",
      amount: "1.00",
      studentId: "someone-else",
    } as unknown as { enrollmentId: string; purpose: string };
    const result = await createOnlineOrderAction(tampered);
    expect(result.ok).toBe(true);
    expect(createMyOnlineOrder).toHaveBeenCalledWith({
      enrollmentId: ENROLLMENT_ID,
      purpose: "full_outstanding",
      studentId: "student-profile",
      authUserId: "student-auth",
    });
  });

  it.each([
    [{ enrollmentId: "not-a-uuid", purpose: "full_outstanding" }],
    [{ enrollmentId: ENROLLMENT_ID, purpose: "custom_amount" }],
  ])("rejects invalid input %j", async (input) => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(context("student"));
    expect((await createOnlineOrderAction(input)).ok).toBe(false);
    expect(createMyOnlineOrder).not.toHaveBeenCalled();
  });

  it("is rate limited per user", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(context("student"));
    vi.mocked(checkRateLimit).mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 30,
    });
    const result = await createOnlineOrderAction({
      enrollmentId: ENROLLMENT_ID,
      purpose: "full_outstanding",
    });
    expect(result.ok).toBe(false);
    expect(checkRateLimit).toHaveBeenCalledWith("razorpay-order:student-auth", {
      limit: 10,
      windowSeconds: 60,
    });
    expect(createMyOnlineOrder).not.toHaveBeenCalled();
  });
});

describe("verifyOnlinePaymentAction", () => {
  it.each([["admin"], ["trainer"]] as const)("refuses a %s", async (role) => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(context(role));
    expect((await verifyOnlinePaymentAction(validCheckout)).status).toBe("failed");
    expect(verifyMyCheckout).not.toHaveBeenCalled();
  });

  it.each([
    [{ ...validCheckout, razorpay_signature: "zz" }],
    [{ ...validCheckout, razorpay_order_id: "order_1; drop" }],
    [{ ...validCheckout, razorpay_payment_id: undefined }],
    ["not an object"],
  ])("rejects malformed Checkout data %#", async (input) => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(context("student"));
    expect((await verifyOnlinePaymentAction(input)).status).toBe("failed");
    expect(verifyMyCheckout).not.toHaveBeenCalled();
  });

  it("verifies for the session's student and refreshes the portal on success", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(context("student"));
    vi.mocked(verifyMyCheckout).mockResolvedValue({
      status: "paid",
      paymentCode: "PAY-000010",
      enrollmentId: ENROLLMENT_ID,
    });
    expect(await verifyOnlinePaymentAction(validCheckout)).toEqual({
      status: "paid",
      paymentCode: "PAY-000010",
      enrollmentId: ENROLLMENT_ID,
    });
    expect(verifyMyCheckout).toHaveBeenCalledWith({
      checkout: validCheckout,
      studentId: "student-profile",
    });
    expect(revalidatePath).toHaveBeenCalledWith(`/student/enrollments/${ENROLLMENT_ID}`);
  });

  it("does not refresh anything for a failed verification", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(context("student"));
    vi.mocked(verifyMyCheckout).mockResolvedValue({ status: "failed", message: "x" });
    await verifyOnlinePaymentAction(validCheckout);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
