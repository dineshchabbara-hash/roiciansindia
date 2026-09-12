import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { BATCH_STATUSES } from "@/lib/domain/batches";

/**
 * Plain GET form, same pattern as
 * components/admin/programs/program-filters.tsx: search/filter state lives
 * entirely in the URL, and the server does all filtering.
 */
export function BatchFilters({
  q,
  programId,
  trainerId,
  status,
  programOptions,
  trainerOptions,
}: {
  q?: string;
  programId?: string;
  trainerId?: string;
  status?: string;
  programOptions: Array<{ id: string; name: string }>;
  trainerOptions: Array<{ id: string; firstName: string; lastName: string }>;
}) {
  return (
    <form method="GET" action="/admin/batches" className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="q">Search</Label>
        <Input
          id="q"
          name="q"
          defaultValue={q}
          placeholder="Batch name"
          className="w-56"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="programId">Program</Label>
        <select
          id="programId"
          name="programId"
          defaultValue={programId ?? ""}
          className="border-input h-9 rounded-md border bg-transparent px-3 text-sm shadow-xs"
        >
          <option value="">All programs</option>
          {programOptions.map((program) => (
            <option key={program.id} value={program.id}>
              {program.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="trainerId">Trainer</Label>
        <select
          id="trainerId"
          name="trainerId"
          defaultValue={trainerId ?? ""}
          className="border-input h-9 rounded-md border bg-transparent px-3 text-sm shadow-xs"
        >
          <option value="">All trainers</option>
          {trainerOptions.map((trainer) => (
            <option key={trainer.id} value={trainer.id}>
              {trainer.firstName} {trainer.lastName}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="status">Status</Label>
        <select
          id="status"
          name="status"
          defaultValue={status ?? ""}
          className="border-input h-9 rounded-md border bg-transparent px-3 text-sm shadow-xs"
        >
          <option value="">All statuses</option>
          {BATCH_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </option>
          ))}
        </select>
      </div>

      <Button type="submit" variant="secondary">
        Apply
      </Button>
      <Button type="button" variant="ghost" asChild>
        <Link href="/admin/batches">Reset</Link>
      </Button>
    </form>
  );
}
