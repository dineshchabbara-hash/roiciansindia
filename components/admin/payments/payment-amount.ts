import { formatDecimalAsINR } from "@/lib/domain/money";
import { paiseToDecimalString } from "@/lib/domain/reports";

/**
 * Exact INR with paise ("₹2,500.50"). The ledger never uses the
 * whole-rupee formatPaiseAsINR: a payment of ₹2,500.50 must not display as
 * ₹2,501, and an outstanding ceiling must be shown to the paisa.
 */
export function formatPaiseExact(paise: number): string {
  return formatDecimalAsINR(paiseToDecimalString(paise));
}
