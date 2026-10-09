import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUSES,
  PAYMENT_STATUS_LABELS,
  type PaymentLedgerFilters,
} from "@/lib/domain/payments";

const SELECT_CLASS =
  "border-input h-9 rounded-md border bg-transparent px-3 text-sm shadow-xs";

/**
 * Plain GET form (no client JS), the same pattern as the Admin Students
 * list and the Phase 19 reports: filter state lives in the URL and every
 * filter is applied server-side by lib/data/payments.ts.
 */
export function PaymentLedgerFiltersForm({ filters }: { filters: PaymentLedgerFilters }) {
  return (
    <form
      method="GET"
      action="/admin/payments"
      aria-label="Payment filters"
      className="flex flex-wrap items-end gap-3"
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="payments-q">Search</Label>
        <Input
          id="payments-q"
          name="q"
          defaultValue={filters.q}
          placeholder="Payment code, reference, student, enrollment code"
          className="w-80"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="payments-method">Method</Label>
        <select
          id="payments-method"
          name="method"
          defaultValue={filters.method ?? ""}
          className={SELECT_CLASS}
        >
          <option value="">All methods</option>
          {PAYMENT_METHODS.map((method) => (
            <option key={method} value={method}>
              {PAYMENT_METHOD_LABELS[method]}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="payments-status">Status</Label>
        <select
          id="payments-status"
          name="status"
          defaultValue={filters.status ?? ""}
          className={SELECT_CLASS}
        >
          <option value="">All statuses</option>
          {PAYMENT_STATUSES.map((status) => (
            <option key={status} value={status}>
              {PAYMENT_STATUS_LABELS[status]}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="payments-from">Payment date from</Label>
        <Input
          id="payments-from"
          name="from"
          type="date"
          defaultValue={filters.from ?? ""}
          className="w-40"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="payments-to">Payment date to</Label>
        <Input
          id="payments-to"
          name="to"
          type="date"
          defaultValue={filters.to ?? ""}
          className="w-40"
        />
      </div>

      <div className="flex gap-2">
        <Button type="submit">Apply filters</Button>
        <Button variant="outline" asChild>
          <Link href="/admin/payments">Clear</Link>
        </Button>
      </div>
    </form>
  );
}
