import { getCurrentUserContext } from "@/lib/auth/session";
import { isAdminOrSuperAdmin } from "@/lib/domain/rbac";
import { getReceiptPdfForViewer, type ReceiptPdfFailure } from "@/lib/data/receipts";

/**
 * GET /api/payments/[id]/receipt — Phase 21A receipt download (FR-94).
 *
 * Admin / Super Admin: any paid payment's receipt. Student: only receipts
 * of their own payments — enforced by RLS on payments, receipts and the
 * private `receipts` bucket (lib/data/receipts.ts reads all three through
 * the viewer's own session), so another Student's payment id is answered
 * exactly like an unknown one (404). Trainer: no financial documents.
 *
 * The PDF is streamed from this route rather than handed out as a signed
 * Storage URL: the object path never reaches the browser and the link is
 * useless without the viewer's own session. A paid payment whose receipt
 * is missing or whose PDF is still pending is issued/generated on demand
 * (idempotent — the same number is reused). Downloads are not audited;
 * issuance is (receipt.issued, written by the database).
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const FAILURE_STATUS: Record<ReceiptPdfFailure, number> = {
  not_found: 404,
  not_eligible: 409,
  pending: 503,
  error: 500,
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function textResponse(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const user = await getCurrentUserContext();
  if (!user) return textResponse(401, "Sign in to download receipts.");
  if (!isAdminOrSuperAdmin(user.role) && user.role !== "student") {
    return textResponse(403, "You do not have permission to download receipts.");
  }

  const { id } = await params;
  if (!UUID_PATTERN.test(id)) return textResponse(404, "Receipt not found.");

  const result = await getReceiptPdfForViewer(id);
  if (!result.ok) return textResponse(FAILURE_STATUS[result.reason], result.error);

  return new Response(result.data.bytes as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${result.data.fileName}"`,
      "Content-Length": String(result.data.bytes.byteLength),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
