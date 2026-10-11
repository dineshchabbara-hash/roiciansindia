"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  createOnlineOrderAction,
  verifyOnlinePaymentAction,
} from "@/lib/actions/online-payments";
import type { OnlinePaymentPurpose } from "@/lib/domain/online-payments";

/**
 * Razorpay Standard Checkout for the Student (Phase 20B). Card, UPI and
 * bank details are entered only in Razorpay's hosted Checkout — nothing
 * here sees them. This component sends just the enrollment id and the
 * chosen option to the server, opens Checkout with the server-created
 * order, and hands Razorpay's result straight back to the server, which
 * verifies the signature and asks Razorpay itself whether the payment was
 * captured. The browser never decides that a payment succeeded.
 */

const CHECKOUT_SCRIPT = "https://checkout.razorpay.com/v1/checkout.js";

type CheckoutSuccess = {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
};

type RazorpayInstance = {
  open(): void;
  on(event: "payment.failed", handler: () => void): void;
};

type RazorpayConstructor = new (options: Record<string, unknown>) => RazorpayInstance;

declare global {
  interface Window {
    Razorpay?: RazorpayConstructor;
  }
}

let scriptPromise: Promise<boolean> | null = null;

function loadCheckoutScript(): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  if (window.Razorpay) return Promise.resolve(true);
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve) => {
      const script = document.createElement("script");
      script.src = CHECKOUT_SCRIPT;
      script.async = true;
      script.onload = () => resolve(Boolean(window.Razorpay));
      script.onerror = () => {
        scriptPromise = null;
        resolve(false);
      };
      document.body.appendChild(script);
    });
  }
  return scriptPromise;
}

export type PayOnlineOption = {
  purpose: OnlinePaymentPurpose;
  label: string;
  amountLabel: string;
};

type Message = { kind: "status" | "error"; text: string };

export function PayOnlineButtons({
  enrollmentId,
  options,
  merchantName,
}: {
  enrollmentId: string;
  options: PayOnlineOption[];
  merchantName: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const settled = useRef(false);

  async function pay(purpose: OnlinePaymentPurpose) {
    setBusy(true);
    setMessage(null);
    settled.current = false;

    const order = await createOnlineOrderAction({ enrollmentId, purpose });
    if (!order.ok) {
      setMessage({ kind: "error", text: order.error });
      setBusy(false);
      return;
    }

    if (!(await loadCheckoutScript()) || !window.Razorpay) {
      setMessage({
        kind: "error",
        text: "The payment window could not be loaded. Check your connection and try again.",
      });
      setBusy(false);
      return;
    }

    const checkout = new window.Razorpay({
      key: order.checkout.keyId,
      order_id: order.checkout.orderId,
      amount: order.checkout.amountPaise,
      currency: order.checkout.currency,
      name: merchantName,
      description: order.checkout.description,
      handler: async (response: CheckoutSuccess) => {
        settled.current = true;
        setMessage({ kind: "status", text: "Confirming your payment…" });
        const result = await verifyOnlinePaymentAction({
          razorpay_order_id: response.razorpay_order_id,
          razorpay_payment_id: response.razorpay_payment_id,
          razorpay_signature: response.razorpay_signature,
        });
        if (result.status === "paid") {
          setMessage({
            kind: "status",
            text: `Payment received — ${result.paymentCode}. Your balance has been updated.`,
          });
        } else if (result.status === "processing") {
          setMessage({
            kind: "status",
            text: "Payment received. It is being confirmed and your balance will update shortly.",
          });
        } else if (result.status === "held") {
          setMessage({
            kind: "status",
            text: "Payment received. Our team will review it before it is applied to your balance.",
          });
        } else {
          setMessage({ kind: "error", text: result.message });
        }
        setBusy(false);
        router.refresh();
      },
      modal: {
        ondismiss: () => {
          if (settled.current) return;
          setMessage({
            kind: "status",
            text: "Payment cancelled. You have not been charged.",
          });
          setBusy(false);
        },
      },
    });
    checkout.on("payment.failed", () => {
      setMessage({
        kind: "error",
        text: "The payment did not go through. You can try again; nothing has been recorded.",
      });
    });
    checkout.open();
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-3">
        {options.map((option) => (
          <Button
            key={option.purpose}
            type="button"
            variant={option.purpose === "full_outstanding" ? "default" : "outline"}
            disabled={busy}
            onClick={() => void pay(option.purpose)}
          >
            {`${option.label} — ${option.amountLabel}`}
          </Button>
        ))}
      </div>
      {message &&
        (message.kind === "error" ? (
          <p role="alert" className="text-destructive text-sm">
            {message.text}
          </p>
        ) : (
          <p role="status" className="text-sm">
            {message.text}
          </p>
        ))}
    </div>
  );
}
