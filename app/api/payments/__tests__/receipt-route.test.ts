import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({ getCurrentUserContext: vi.fn() }));
vi.mock("@/lib/data/receipts", () => ({ getReceiptPdfForViewer: vi.fn() }));

import { GET } from "@/app/api/payments/[id]/receipt/route";
import { getCurrentUserContext } from "@/lib/auth/session";
import { getReceiptPdfForViewer } from "@/lib/data/receipts";

const PAYMENT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

function context(role: "admin" | "super_admin" | "trainer" | "student") {
  return {
    authUserId: `${role}-auth-1`,
    email: `${role}@example.com`,
    role,
    profileId: `${role}-profile-1`,
    displayName: `Test ${role}`,
  };
}

function call(id: string = PAYMENT_ID) {
  return GET(new Request(`http://localhost/api/payments/${id}/receipt`), {
    params: Promise.resolve({ id }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/payments/[id]/receipt", () => {
  it("requires a session", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(null);
    const response = await call();
    expect(response.status).toBe(401);
    expect(getReceiptPdfForViewer).not.toHaveBeenCalled();
  });

  it("gives a Trainer no financial documents", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(context("trainer"));
    const response = await call();
    expect(response.status).toBe(403);
    expect(getReceiptPdfForViewer).not.toHaveBeenCalled();
  });

  it("rejects a malformed id before any lookup", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(context("student"));
    expect((await call("not-a-uuid")).status).toBe(404);
    expect(getReceiptPdfForViewer).not.toHaveBeenCalled();
  });

  it.each([
    ["not_found", 404],
    ["not_eligible", 409],
    ["pending", 503],
    ["error", 500],
  ] as const)("maps %s to %i without leaking detail", async (reason, status) => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(context("student"));
    vi.mocked(getReceiptPdfForViewer).mockResolvedValue({
      ok: false,
      reason,
      error: "Public message.",
    });
    const response = await call();
    expect(response.status).toBe(status);
    expect(await response.text()).toBe("Public message.");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it.each([["admin"], ["super_admin"], ["student"]] as const)(
    "streams the PDF to an authorized %s as a private attachment",
    async (role) => {
      vi.mocked(getCurrentUserContext).mockResolvedValue(context(role));
      vi.mocked(getReceiptPdfForViewer).mockResolvedValue({
        ok: true,
        data: {
          fileName: "REC-2026-000007.pdf",
          bytes: new Uint8Array([37, 80, 68, 70]),
        },
      });
      const response = await call();
      expect(response.status).toBe(200);
      expect(getReceiptPdfForViewer).toHaveBeenCalledExactlyOnceWith(PAYMENT_ID);
      expect(response.headers.get("content-type")).toBe("application/pdf");
      expect(response.headers.get("content-disposition")).toBe(
        'attachment; filename="REC-2026-000007.pdf"',
      );
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(
        new Uint8Array([37, 80, 68, 70]),
      );
    },
  );
});
