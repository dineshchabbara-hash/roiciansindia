import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

/**
 * Plain GET form — no client JS required. Search/filter state lives
 * entirely in the URL, so it's shareable/bookmarkable and the server does
 * all filtering (never a client-side fake filter over a fetched page).
 */
export function StudentFilters({
  q,
  status,
  programId,
  batchId,
  programs,
  batches,
}: {
  q?: string;
  status?: string;
  programId?: string;
  batchId?: string;
  programs: Array<{ id: string; name: string }>;
  batches: Array<{ id: string; name: string }>;
}) {
  return (
    <form
      method="GET"
      action="/admin/students"
      className="flex flex-wrap items-end gap-3"
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="q">Search</Label>
        <Input
          id="q"
          name="q"
          defaultValue={q}
          placeholder="Name, Student ID, email, or phone"
          className="w-64"
        />
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
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="archived">Archived</option>
        </select>
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
          {programs.map((program) => (
            <option key={program.id} value={program.id}>
              {program.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="batchId">Batch</Label>
        <select
          id="batchId"
          name="batchId"
          defaultValue={batchId ?? ""}
          className="border-input h-9 rounded-md border bg-transparent px-3 text-sm shadow-xs"
        >
          <option value="">All batches</option>
          {batches.map((batch) => (
            <option key={batch.id} value={batch.id}>
              {batch.name}
            </option>
          ))}
        </select>
      </div>

      <Button type="submit" variant="secondary">
        Apply
      </Button>
    </form>
  );
}
