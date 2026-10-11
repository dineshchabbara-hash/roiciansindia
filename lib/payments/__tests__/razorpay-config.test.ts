import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  getRazorpayKeys,
  getRazorpayWebhookSecret,
} from "@/lib/payments/razorpay-config";

afterEach(() => {
  vi.unstubAllEnvs();
});

// Placeholder values only — shaped like test keys, not real credentials.
describe("getRazorpayKeys — TEST MODE ONLY", () => {
  it("accepts a test-mode key id with a secret", () => {
    vi.stubEnv("RAZORPAY_KEY_ID", "rzp_test_PLACEHOLDER01");
    vi.stubEnv("RAZORPAY_KEY_SECRET", "placeholder-secret");
    expect(getRazorpayKeys()).toEqual({
      ok: true,
      keys: { keyId: "rzp_test_PLACEHOLDER01", keySecret: "placeholder-secret" },
    });
  });

  it("refuses a live key id", () => {
    vi.stubEnv("RAZORPAY_KEY_ID", "rzp_live_PLACEHOLDER01");
    vi.stubEnv("RAZORPAY_KEY_SECRET", "placeholder-secret");
    expect(getRazorpayKeys()).toEqual({ ok: false, reason: "live_key_refused" });
  });

  it.each([
    ["no key id", "", "placeholder-secret"],
    ["no secret", "rzp_test_PLACEHOLDER01", ""],
  ])("reports missing configuration with %s", (_label, keyId, secret) => {
    vi.stubEnv("RAZORPAY_KEY_ID", keyId);
    vi.stubEnv("RAZORPAY_KEY_SECRET", secret);
    expect(getRazorpayKeys()).toEqual({ ok: false, reason: "missing" });
  });

  it("rejects the .env.example placeholder shape and other malformed ids", () => {
    vi.stubEnv("RAZORPAY_KEY_SECRET", "placeholder-secret");
    for (const keyId of ["rzp_test_", "your-key-id", "rzp_test_has space"]) {
      vi.stubEnv("RAZORPAY_KEY_ID", keyId);
      expect(getRazorpayKeys()).toEqual({ ok: false, reason: "malformed_key_id" });
    }
  });

  it("reads the webhook secret separately and treats blank as unset", () => {
    vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", "  ");
    expect(getRazorpayWebhookSecret()).toBeNull();
    vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", "placeholder-webhook-secret");
    expect(getRazorpayWebhookSecret()).toBe("placeholder-webhook-secret");
  });
});
