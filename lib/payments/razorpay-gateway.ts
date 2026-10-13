import "server-only";

import Razorpay from "razorpay";
import type { RazorpayKeys } from "@/lib/payments/razorpay-config";

/**
 * The narrow seam between Roicians and Razorpay's HTTP API: the two calls
 * Phase 20B needs plus the two Phase 21B refund calls. Everything above it (order rules, signature
 * checks, finalization) is provider-agnostic and is unit-tested by
 * mocking this module, so the automated suite never calls Razorpay.
 *
 * Uses the official `razorpay` SDK (pinned 2.9.8) server-side only.
 * Orders are always INR, never `partial_payment` (Razorpay's own
 * partial-payment feature is a different concept from Roicians allowing
 * several payments per enrollment, and is not used).
 */

export type GatewayOrder = {
  id: string;
  amountPaise: number;
  currency: string;
  status: string;
};

export type GatewayPayment = {
  id: string;
  orderId: string | null;
  amountPaise: number;
  currency: string;
  /** Razorpay payment status: created | authorized | captured | refunded | failed */
  status: string;
  createdAtUnix: number | null;
};

/** Razorpay refund status: pending | processed | failed (official SDK types). */
export type GatewayRefund = {
  id: string;
  paymentId: string;
  amountPaise: number;
  currency: string;
  status: string;
  notes: Record<string, string>;
};

export interface RazorpayGateway {
  createOrder(input: {
    amountPaise: number;
    receipt: string;
    notes: Record<string, string>;
  }): Promise<GatewayOrder>;
  fetchPayment(paymentId: string): Promise<GatewayPayment>;
  /** Phase 21B: refund (part of) a captured payment, server-side only. */
  createRefund(input: {
    paymentId: string;
    amountPaise: number;
    receipt: string;
    notes: Record<string, string>;
  }): Promise<GatewayRefund>;
  /** Phase 21B: every refund Razorpay holds for one payment (reconciliation). */
  listRefunds(paymentId: string): Promise<GatewayRefund[]>;
}

type SdkRefund = {
  id: unknown;
  payment_id: unknown;
  amount: unknown;
  currency: unknown;
  status: unknown;
  notes?: unknown;
};

function toGatewayRefund(refund: SdkRefund): GatewayRefund {
  const notes: Record<string, string> = {};
  if (refund.notes && typeof refund.notes === "object" && !Array.isArray(refund.notes)) {
    for (const [key, value] of Object.entries(refund.notes as Record<string, unknown>)) {
      if (typeof value === "string" || typeof value === "number")
        notes[key] = String(value);
    }
  }
  return {
    id: String(refund.id),
    paymentId: String(refund.payment_id),
    amountPaise: Number(refund.amount),
    currency: String(refund.currency),
    status: String(refund.status),
    notes,
  };
}

/**
 * True when Razorpay definitively rejected a request (a 4xx answer other
 * than timeout / rate limit), i.e. nothing was created at the provider.
 * Network failures, timeouts and 5xx answers are NOT definitive: the
 * request may have been applied, so callers must reconcile, not retry.
 */
export function isDefinitiveRejection(error: unknown): boolean {
  const status =
    error && typeof error === "object" && "statusCode" in error
      ? Number((error as { statusCode: unknown }).statusCode)
      : NaN;
  return (
    Number.isInteger(status) &&
    status >= 400 &&
    status < 500 &&
    status !== 408 &&
    status !== 429
  );
}

export function createRazorpayGateway(keys: RazorpayKeys): RazorpayGateway {
  const client = new Razorpay({ key_id: keys.keyId, key_secret: keys.keySecret });
  return {
    async createOrder({ amountPaise, receipt, notes }) {
      if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0) {
        throw new Error("Order amount must be a positive integer number of paise");
      }
      const order = await client.orders.create({
        amount: amountPaise,
        currency: "INR",
        receipt,
        notes,
        partial_payment: false,
      });
      return {
        id: String(order.id),
        amountPaise: Number(order.amount),
        currency: String(order.currency),
        status: String(order.status),
      };
    },
    async fetchPayment(paymentId) {
      const payment = await client.payments.fetch(paymentId);
      return {
        id: String(payment.id),
        orderId: payment.order_id ? String(payment.order_id) : null,
        amountPaise: Number(payment.amount),
        currency: String(payment.currency),
        status: String(payment.status),
        createdAtUnix: typeof payment.created_at === "number" ? payment.created_at : null,
      };
    },
    async createRefund({ paymentId, amountPaise, receipt, notes }) {
      if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0) {
        throw new Error("Refund amount must be a positive integer number of paise");
      }
      const refund = await client.payments.refund(paymentId, {
        amount: amountPaise,
        speed: "normal",
        receipt,
        notes,
      });
      return toGatewayRefund(refund as unknown as SdkRefund);
    },
    async listRefunds(paymentId) {
      const result = await client.payments.fetchMultipleRefund(paymentId, { count: 100 });
      return (result.items ?? []).map((item) =>
        toGatewayRefund(item as unknown as SdkRefund),
      );
    },
  };
}
