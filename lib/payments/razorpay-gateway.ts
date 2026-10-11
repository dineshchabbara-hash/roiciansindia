import "server-only";

import Razorpay from "razorpay";
import type { RazorpayKeys } from "@/lib/payments/razorpay-config";

/**
 * The narrow seam between Roicians and Razorpay's HTTP API: exactly the
 * two calls Phase 20B needs. Everything above it (order rules, signature
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

export interface RazorpayGateway {
  createOrder(input: {
    amountPaise: number;
    receipt: string;
    notes: Record<string, string>;
  }): Promise<GatewayOrder>;
  fetchPayment(paymentId: string): Promise<GatewayPayment>;
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
  };
}
