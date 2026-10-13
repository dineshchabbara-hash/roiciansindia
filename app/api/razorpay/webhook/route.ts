import { processRazorpayWebhook } from "@/lib/data/online-payments";

/**
 * Razorpay webhook (Phase 20B; FR-93, SEC-5). POST /api/razorpay/webhook.
 *
 * Authenticated by Razorpay's HMAC signature over the RAW body (read with
 * request.text() before any parsing), not by a user session — no cookie is
 * read or required (the path is also excluded from the session-refresh
 * proxy). Only `payment.captured` (Phase 20B) and `refund.processed` /
 * `refund.failed` (Phase 21B) change anything; every other event is logged
 * as ignored. Responses carry no detail: 400 bad signature/body,
 * 503 not configured, 500 transient failure (Razorpay redelivers; the
 * finalization and refund application are idempotent), 200 otherwise —
 * including duplicates and orders/refunds this system does not know.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 256 * 1024;

export async function POST(request: Request): Promise<Response> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return new Response(null, { status: 413 });

  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
    return new Response(null, { status: 413 });
  }

  const result = await processRazorpayWebhook({
    rawBody,
    signature: request.headers.get("x-razorpay-signature"),
    eventIdHeader: request.headers.get("x-razorpay-event-id"),
  });
  return new Response(null, { status: result.httpStatus });
}
