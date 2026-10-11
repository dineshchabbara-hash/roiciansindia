import "server-only";

/**
 * Razorpay configuration (API_AND_INTEGRATIONS.md §2.2). Server-only: the
 * key secret and webhook secret are read from the environment here and
 * never leave the server. The key ID is public by design (Standard
 * Checkout needs it in the browser) and is handed to the client per order
 * by the order-creation action, not via a NEXT_PUBLIC_ variable.
 *
 * Phase 20B is TEST MODE ONLY: a live key (`rzp_live_…`) is refused, so a
 * mis-set environment can never move real money through this build. Going
 * live is a separate, deliberate pre-production change.
 */

export type RazorpayKeys = { keyId: string; keySecret: string };

export type RazorpayConfigResult =
  | { ok: true; keys: RazorpayKeys }
  | { ok: false; reason: "missing" | "live_key_refused" | "malformed_key_id" };

const TEST_KEY_ID = /^rzp_test_[A-Za-z0-9]+$/;

export function getRazorpayKeys(): RazorpayConfigResult {
  const keyId = process.env.RAZORPAY_KEY_ID?.trim() ?? "";
  const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim() ?? "";
  if (!keyId || !keySecret) return { ok: false, reason: "missing" };
  if (keyId.startsWith("rzp_live_")) return { ok: false, reason: "live_key_refused" };
  if (!TEST_KEY_ID.test(keyId)) return { ok: false, reason: "malformed_key_id" };
  return { ok: true, keys: { keyId, keySecret } };
}

export function getRazorpayWebhookSecret(): string | null {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET?.trim() ?? "";
  return secret ? secret : null;
}
