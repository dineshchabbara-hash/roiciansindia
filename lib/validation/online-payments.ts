import { z } from "zod";
import { ONLINE_PAYMENT_PURPOSES } from "@/lib/domain/online-payments";

/**
 * Phase 20B input shapes (SEC-3: every external input validated on the
 * server). Neither schema carries an amount, student or status: the order
 * amount is derived server-side and success is established only by
 * Razorpay (signature + fetched captured status, or a signed webhook).
 */

export const createOnlineOrderSchema = z.object({
  enrollmentId: z.string().uuid("This page is out of date. Reload and try again."),
  purpose: z.enum(ONLINE_PAYMENT_PURPOSES, { message: "Choose what to pay." }),
});

export type CreateOnlineOrderInput = z.infer<typeof createOnlineOrderSchema>;

// Razorpay ids are `order_…` / `pay_…` with alphanumeric suffixes; the
// Checkout signature is a 64-char lowercase hex HMAC-SHA256.
export const checkoutResultSchema = z.object({
  razorpay_order_id: z.string().regex(/^order_[A-Za-z0-9]{1,40}$/),
  razorpay_payment_id: z.string().regex(/^pay_[A-Za-z0-9]{1,40}$/),
  razorpay_signature: z.string().regex(/^[0-9a-f]{64}$/),
});

export type CheckoutResultInput = z.infer<typeof checkoutResultSchema>;
