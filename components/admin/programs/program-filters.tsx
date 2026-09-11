import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { PROGRAM_STATUSES } from "@/lib/domain/programs";

/**
 * Plain GET form, same pattern as
 * components/admin/trainers/trainer-filters.tsx: search/filter state lives
 * entirely in the URL, and the server does all filtering.
 */
export function ProgramFilters({ q, status }: { q?: string; status?: string }) {
  return (
    <form
      method="GET"
      action="/admin/programs"
      className="flex flex-wrap items-end gap-3"
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="q">Search</Label>
        <Input
          id="q"
          name="q"
          defaultValue={q}
          placeholder="Code, name, description, or category"
          className="w-72"
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
          {PROGRAM_STATUSES.map((s) => (
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
        <Link href="/admin/programs">Reset</Link>
      </Button>
    </form>
  );
}
