import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

/**
 * Plain GET form, same pattern as components/admin/students/student-filters.tsx:
 * search/filter state lives entirely in the URL (shareable/bookmarkable),
 * and the server does all filtering.
 */
export function TrainerFilters({ q, status }: { q?: string; status?: string }) {
  return (
    <form
      method="GET"
      action="/admin/trainers"
      className="flex flex-wrap items-end gap-3"
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="q">Search</Label>
        <Input
          id="q"
          name="q"
          defaultValue={q}
          placeholder="Name, email, or phone"
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
        </select>
      </div>

      <Button type="submit" variant="secondary">
        Apply
      </Button>
      <Button type="button" variant="ghost" asChild>
        <Link href="/admin/trainers">Reset</Link>
      </Button>
    </form>
  );
}
