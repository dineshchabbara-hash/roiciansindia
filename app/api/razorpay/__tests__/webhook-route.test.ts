import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data/online-payments", () => ({ processRazorpayWebhook: vi.fn() }));

import { POST } from "@/app/api/razorpay/webhook/route";
import { processRazorpayWebhook } from "@/lib/data/online-payments";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/razorpay/webhook", () => {
  it("passes the exact raw body and Razorpay headers through, with no session involved", async () => {
    vi.mocked(processRazorpayWebhook).mockResolvedValue({
      httpStatus: 200,
      outcome: "recorded",
    });
    const raw = '{"event":"payment.captured",  "payload":{}}';
    const response = await POST(
      new Request("http://localhost/api/razorpay/webhook", {
        method: "POST",
        body: raw,
        headers: {
          "content-type": "application/json",
          "x-razorpay-signature": "abc",
          "x-razorpay-event-id": "evt_1",
        },
      }),
    );
    expect(response.status).toBe(200);
    expect(processRazorpayWebhook).toHaveBeenCalledWith({
      rawBody: raw,
      signature: "abc",
      eventIdHeader: "evt_1",
    });
    expect(await response.text()).toBe("");
  });

  it.each([[400], [503], [500]])(
    "relays status %i with an empty body",
    async (status) => {
      vi.mocked(processRazorpayWebhook).mockResolvedValue({
        httpStatus: status,
        outcome: "x",
      });
      const response = await POST(
        new Request("http://localhost/api/razorpay/webhook", {
          method: "POST",
          body: "{}",
        }),
      );
      expect(response.status).toBe(status);
      expect(await response.text()).toBe("");
    },
  );

  it("refuses an oversized body without processing it", async () => {
    const response = await POST(
      new Request("http://localhost/api/razorpay/webhook", {
        method: "POST",
        body: "x".repeat(300 * 1024),
      }),
    );
    expect(response.status).toBe(413);
    expect(processRazorpayWebhook).not.toHaveBeenCalled();
  });
});
