import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  verifyCheckoutSignature,
  verifyWebhookSignature,
} from "@/lib/payments/razorpay-signature";

// Test-only secrets — not real credentials.
const KEY_SECRET = "unit-test-key-secret";
const WEBHOOK_SECRET = "unit-test-webhook-secret";

function hmac(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

describe("verifyCheckoutSignature (order_id|payment_id, key secret)", () => {
  const orderId = "order_TEST123";
  const paymentId = "pay_TEST456";
  const valid = hmac(KEY_SECRET, `${orderId}|${paymentId}`);

  it("accepts Razorpay's documented signature", () => {
    expect(
      verifyCheckoutSignature({
        orderId,
        paymentId,
        signature: valid,
        keySecret: KEY_SECRET,
      }),
    ).toBe(true);
  });

  it.each([
    ["a different payment id", { paymentId: "pay_OTHER" }],
    ["a different order id", { orderId: "order_OTHER" }],
    ["the wrong secret", { keySecret: "another-secret" }],
    ["an empty secret", { keySecret: "" }],
  ])("rejects %s", (_label, override) => {
    expect(
      verifyCheckoutSignature({
        orderId,
        paymentId,
        signature: valid,
        keySecret: KEY_SECRET,
        ...override,
      }),
    ).toBe(false);
  });

  it.each([
    ["a tampered last character", valid.slice(0, -1) + (valid.endsWith("0") ? "1" : "0")],
    ["uppercase hex", valid.toUpperCase()],
    ["a truncated value", valid.slice(0, 63)],
    ["an empty value", ""],
    ["the order|payment string itself", `${orderId}|${paymentId}`],
  ])("rejects %s", (_label, signature) => {
    expect(
      verifyCheckoutSignature({ orderId, paymentId, signature, keySecret: KEY_SECRET }),
    ).toBe(false);
  });

  it("is order-sensitive (payment|order is not accepted)", () => {
    const swapped = hmac(KEY_SECRET, `${paymentId}|${orderId}`);
    expect(
      verifyCheckoutSignature({
        orderId,
        paymentId,
        signature: swapped,
        keySecret: KEY_SECRET,
      }),
    ).toBe(false);
  });
});

describe("verifyWebhookSignature (raw body, webhook secret)", () => {
  const rawBody = JSON.stringify({
    event: "payment.captured",
    payload: { payment: { entity: { id: "pay_TEST456", amount: 50000 } } },
  });
  const valid = hmac(WEBHOOK_SECRET, rawBody);

  it("accepts the signature over the exact raw bytes", () => {
    expect(
      verifyWebhookSignature({
        rawBody,
        signature: valid,
        webhookSecret: WEBHOOK_SECRET,
      }),
    ).toBe(true);
    expect(
      verifyWebhookSignature({
        rawBody: Buffer.from(rawBody),
        signature: valid,
        webhookSecret: WEBHOOK_SECRET,
      }),
    ).toBe(true);
  });

  it("rejects a re-serialized body (whitespace changes the bytes)", () => {
    const reformatted = JSON.stringify(JSON.parse(rawBody), null, 2);
    expect(
      verifyWebhookSignature({
        rawBody: reformatted,
        signature: valid,
        webhookSecret: WEBHOOK_SECRET,
      }),
    ).toBe(false);
  });

  it("rejects a modified amount", () => {
    const tampered = rawBody.replace("50000", "5000000");
    expect(
      verifyWebhookSignature({
        rawBody: tampered,
        signature: valid,
        webhookSecret: WEBHOOK_SECRET,
      }),
    ).toBe(false);
  });

  it("rejects a signature made with the Checkout key secret", () => {
    const wrongKey = hmac(KEY_SECRET, rawBody);
    expect(
      verifyWebhookSignature({
        rawBody,
        signature: wrongKey,
        webhookSecret: WEBHOOK_SECRET,
      }),
    ).toBe(false);
  });

  it.each([
    ["a missing header", null],
    ["an empty header", ""],
    ["non-hex garbage", "not-a-signature"],
  ])("rejects %s", (_label, signature) => {
    expect(
      verifyWebhookSignature({ rawBody, signature, webhookSecret: WEBHOOK_SECRET }),
    ).toBe(false);
  });

  it("never verifies when the secret is not configured", () => {
    expect(
      verifyWebhookSignature({
        rawBody,
        signature: hmac("", rawBody),
        webhookSecret: "",
      }),
    ).toBe(false);
  });
});
