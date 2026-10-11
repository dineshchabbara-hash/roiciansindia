"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUserContext } from "@/lib/auth/session";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import {
  createMyOnlineOrder,
  verifyMyCheckout,
  type CheckoutPayload,
  type CheckoutVerification,
} from "@/lib/data/online-payments";
import {
  checkoutResultSchema,
  createOnlineOrderSchema,
} from "@/lib/validation/online-payments";

/**
 * Phase 20B Student actions (FR-43, FR-92, FR-93). Student role only —
 * Admin/Super Admin are view-only for online payments
 * (USER_ROLES_AND_PERMISSIONS.md), Trainers have no financial access, and
 * an anonymous caller is refused before anything else runs. The Student's
 * own student id comes from the session, never from the request.
 *
 * Order creation is rate-limited per user (SEC-7). No audit entry is
 * written for an order (nothing financial happens yet); the ledger
 * transition is audited exactly once inside finalize_razorpay_payment().
 */

const NOT_ALLOWED = "Online payment is available to students only.";

export type CreateOrderResult =
  { ok: true; checkout: CheckoutPayload } | { ok: false; error: string };

export async function createOnlineOrderAction(input: {
  enrollmentId: string;
  purpose: string;
}): Promise<CreateOrderResult> {
  const ctx = await getCurrentUserContext();
  if (!ctx || ctx.role !== "student" || !ctx.profileId) {
    return { ok: false, error: NOT_ALLOWED };
  }

  const parsed = createOnlineOrderSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }

  const limit = await checkRateLimit(`razorpay-order:${ctx.authUserId}`, {
    limit: 10,
    windowSeconds: 60,
  });
  if (!limit.allowed) {
    return {
      ok: false,
      error: "Too many payment attempts. Please wait a minute and try again.",
    };
  }

  const result = await createMyOnlineOrder({
    enrollmentId: parsed.data.enrollmentId,
    purpose: parsed.data.purpose,
    studentId: ctx.profileId,
    authUserId: ctx.authUserId,
  });
  return result.ok
    ? { ok: true, checkout: result.data }
    : { ok: false, error: result.error };
}

export async function verifyOnlinePaymentAction(
  input: unknown,
): Promise<CheckoutVerification> {
  const ctx = await getCurrentUserContext();
  if (!ctx || ctx.role !== "student" || !ctx.profileId) {
    return { status: "failed", message: NOT_ALLOWED };
  }

  const parsed = checkoutResultSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "failed", message: "We could not confirm this payment." };
  }

  const result = await verifyMyCheckout({
    checkout: parsed.data,
    studentId: ctx.profileId,
  });
  if (result.status !== "failed") {
    revalidatePath("/student");
    revalidatePath(`/student/enrollments/${result.enrollmentId}`);
  }
  return result;
}
