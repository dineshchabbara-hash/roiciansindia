/**
 * Phase 20B (Razorpay test-mode integration) — pure rules, no I/O.
 *
 * Who pays: the Student, for their own confirmed enrollment
 * (REQUIREMENTS.md FR-43; USER_ROLES_AND_PERMISSIONS.md "Initiate/verify
 * online payment" — Admin view only, Student pay-only).
 *
 * How much (Phase 20B checkpoint decision; FR-92/SEC-6 — never a client
 * amount): the Student picks one of two server-derived amounts —
 *   - the NEXT UNPAID INSTALLMENT: net paid (paid − processed refunds)
 *     covers the plan's installments oldest-first by `sequence`, skipping
 *     waived installments; the first installment not fully covered is the
 *     next one, and the amount is its uncovered remainder, capped at the
 *     outstanding balance. Computed when the order is created only —
 *     nothing is written to `installments` and the ledger row stays
 *     enrollment-level (Phase 20A D9 is unchanged);
 *   - the FULL OUTSTANDING balance (Phase 14 engine).
 * When the next-installment amount equals the outstanding balance the two
 * options are the same payment, so only "full outstanding" is offered.
 *
 * All arithmetic is integer paise.
 */

import { toPaise } from "@/lib/domain/money";
import type { InstallmentStatus } from "@/lib/domain/payment-plans";

export const ONLINE_PAYMENT_PURPOSES = ["next_installment", "full_outstanding"] as const;
export type OnlinePaymentPurpose = (typeof ONLINE_PAYMENT_PURPOSES)[number];

export function isOnlinePaymentPurpose(value: unknown): value is OnlinePaymentPurpose {
  return (
    typeof value === "string" &&
    (ONLINE_PAYMENT_PURPOSES as readonly string[]).includes(value)
  );
}

/** How long a created Razorpay order is reused for repeat "Pay" clicks. */
export const ONLINE_ORDER_TTL_MINUTES = 30;

export type CoverageInstallment = {
  id: string;
  sequence: number;
  label: string | null;
  amount: string | number;
  storedStatus: InstallmentStatus;
};

export type NextInstallmentDue = {
  installmentId: string;
  sequence: number;
  label: string | null;
  amountPaise: number;
};

/**
 * Oldest-first coverage. Returns null when there is no plan, every
 * installment is covered or waived, or nothing is outstanding.
 */
export function computeNextInstallmentDue(
  installments: readonly CoverageInstallment[],
  netPaidPaise: number,
  outstandingPaise: number,
): NextInstallmentDue | null {
  if (outstandingPaise <= 0) return null;
  let remaining = Math.max(0, netPaidPaise);
  const ordered = [...installments].sort((a, b) => a.sequence - b.sequence);
  for (const installment of ordered) {
    if (installment.storedStatus === "waived") continue;
    const amountPaise = toPaise(installment.amount);
    if (amountPaise <= 0) continue;
    if (remaining >= amountPaise) {
      remaining -= amountPaise;
      continue;
    }
    const uncovered = amountPaise - remaining;
    return {
      installmentId: installment.id,
      sequence: installment.sequence,
      label: installment.label,
      amountPaise: Math.min(uncovered, outstandingPaise),
    };
  }
  return null;
}

export type OnlinePaymentOption = {
  purpose: OnlinePaymentPurpose;
  amountPaise: number;
  /** The installment the amount was derived from (next_installment only). */
  installmentId: string | null;
  label: string;
};

export function installmentDisplayName(installment: {
  sequence: number;
  label: string | null;
}): string {
  return installment.label?.trim() || `Installment ${installment.sequence}`;
}

export function buildOnlinePaymentOptions(input: {
  outstandingPaise: number;
  nextInstallment: NextInstallmentDue | null;
}): OnlinePaymentOption[] {
  const { outstandingPaise, nextInstallment } = input;
  if (outstandingPaise <= 0) return [];
  const options: OnlinePaymentOption[] = [];
  if (nextInstallment && nextInstallment.amountPaise < outstandingPaise) {
    options.push({
      purpose: "next_installment",
      amountPaise: nextInstallment.amountPaise,
      installmentId: nextInstallment.installmentId,
      label: `Pay next installment (${installmentDisplayName(nextInstallment)})`,
    });
  }
  options.push({
    purpose: "full_outstanding",
    amountPaise: outstandingPaise,
    installmentId: null,
    label: "Pay full outstanding balance",
  });
  return options;
}

/**
 * Razorpay `receipt` (≤ 40 chars): our enrollment code plus a short unique
 * suffix. Never contains personal data.
 */
export function buildOrderReceipt(
  enrollmentCode: string,
  now: Date,
  nonce: string,
): string {
  const suffix = `${now.getTime().toString(36)}${nonce}`.slice(0, 14);
  return `${enrollmentCode}-${suffix}`.slice(0, 40);
}
