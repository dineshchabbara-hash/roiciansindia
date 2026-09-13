import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { ENROLLMENT_STATUSES } from "@/lib/domain/enrollments";

/**
 * Plain GET form, same pattern as components/admin/batches/batch-filters.tsx:
 * search/filter state lives entirely in the URL, and the server does all
 * filtering.
 */
export function EnrollmentFilters({
  q,
  studentId,
  programId,
  batchId,
  status,
  studentOptions,
  programOptions,
  batchOptions,
}: {
  q?: string;
  studentId?: string;
  programId?: string;
  batchId?: string;
  status?: string;
  studentOptions: Array<{
    id: string;
    firstName: string;
    lastName: string;
    studentCode: string;
  }>;
  programOptions: Array<{ id: string; name: string }>;
  batchOptions: Array<{ id: string; name: string }>;
}) {
  return (
    <form
      method="GET"
      action="/admin/enrollments"
      className="flex flex-wrap items-end gap-3"
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="q">Search</Label>
        <Input
          id="q"
          name="q"
          defaultValue={q}
          placeholder="Enrollment code"
          className="w-56"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="studentId">Student</Label>
        <select
          id="studentId"
          name="studentId"
          defaultValue={studentId ?? ""}
          className="border-input h-9 rounded-md border bg-transparent px-3 text-sm shadow-xs"
        >
          <option value="">All students</option>
          {studentOptions.map((student) => (
            <option key={student.id} value={student.id}>
              {student.firstName} {student.lastName} ({student.studentCode})
            </option>
          ))}
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
          {programOptions.map((program) => (
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
          {batchOptions.map((batch) => (
            <option key={batch.id} value={batch.id}>
              {batch.name}
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
          {ENROLLMENT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace("_", " ")}
            </option>
          ))}
        </select>
      </div>

      <Button type="submit" variant="secondary">
        Apply
      </Button>
      <Button type="button" variant="ghost" asChild>
        <Link href="/admin/enrollments">Reset</Link>
      </Button>
    </form>
  );
}
