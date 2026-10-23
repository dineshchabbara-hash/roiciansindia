// @vitest-environment node
import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

// The real signature check runs; any database access fails the test.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn(() => {
    throw new Error("database reached before signature verification");
  }),
}));
vi.mock("@/lib/data/receipts", () => ({ queueReceiptIssuance: vi.fn() }));

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { POST } from "../webhook/route";

const SECRET = "test-webhook-secret-for-regression";
const body = JSON.stringify({ event: "payment.captured", payload: {} });
const post = (headers: Record<string, string>) =>
  POST(
    new Request("https://staging.example.in/api/razorpay/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body,
    }),
  );

afterEach(() => {
  vi.unstubAllEnvs();
  vi.mocked(createSupabaseAdminClient).mockClear();
});

describe("Razorpay webhook: signature is mandatory", () => {
  it("refuses everything when no webhook secret is configured", async () => {
    vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", "");
    const signature = createHmac("sha256", SECRET).update(body).digest("hex");
    expect((await post({ "x-razorpay-signature": signature })).status).toBe(503);
    expect(createSupabaseAdminClient).not.toHaveBeenCalled();
  });

  it.each([
    ["a missing signature", {}],
    ["an empty signature", { "x-razorpay-signature": "" }],
    ["a wrong signature", { "x-razorpay-signature": "0".repeat(64) }],
    [
      "a signature made with another secret",
      {
        "x-razorpay-signature": createHmac("sha256", "other").update(body).digest("hex"),
      },
    ],
    ["a staging password instead", { authorization: "Basic c3RhZ2luZzpwYXNzd29yZA==" }],
  ])("rejects %s with 400 before any database work", async (_label, headers) => {
    vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", SECRET);
    expect((await post(headers as Record<string, string>)).status).toBe(400);
    expect(createSupabaseAdminClient).not.toHaveBeenCalled();
  });
});
