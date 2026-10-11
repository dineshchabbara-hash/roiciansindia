import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Razorpay signature verification (FR-93, SEC-5) with Node's own HMAC and
 * constant-time comparison. The official SDK's helpers compare with `===`,
 * so they are deliberately not used for verification; the algorithms are
 * Razorpay's documented ones:
 *
 *  - Checkout:  HMAC-SHA256(`${razorpay_order_id}|${razorpay_payment_id}`,
 *               key secret), hex — sent by Checkout as razorpay_signature.
 *  - Webhook:   HMAC-SHA256(raw request body bytes, webhook secret), hex —
 *               sent as the X-Razorpay-Signature header.
 *
 * Both return false (never throw) for a missing/malformed signature or an
 * empty secret, so a misconfiguration can never verify anything.
 */

const HEX_SHA256 = /^[0-9a-f]{64}$/;

function hmacHex(secret: string, payload: string | Buffer): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

function safeEqualHex(expectedHex: string, receivedHex: string): boolean {
  if (!HEX_SHA256.test(receivedHex)) return false;
  const a = Buffer.from(expectedHex, "hex");
  const b = Buffer.from(receivedHex, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function verifyCheckoutSignature(input: {
  orderId: string;
  paymentId: string;
  signature: string;
  keySecret: string;
}): boolean {
  const { orderId, paymentId, signature, keySecret } = input;
  if (!keySecret || !orderId || !paymentId || typeof signature !== "string") return false;
  return safeEqualHex(hmacHex(keySecret, `${orderId}|${paymentId}`), signature);
}

export function verifyWebhookSignature(input: {
  rawBody: string | Buffer;
  signature: string | null;
  webhookSecret: string;
}): boolean {
  const { rawBody, signature, webhookSecret } = input;
  if (!webhookSecret || typeof signature !== "string") return false;
  return safeEqualHex(hmacHex(webhookSecret, rawBody), signature);
}
