"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { ENROLLMENT_STATUSES } from "@/lib/domain/enrollments";

/**
 * Plain GET form, same pattern as components/admin/batches/batch-filters.tsx:
 * search/filter state lives entirely in the URL, and the server does all
 * filtering. Apply/Reset are both full navigations (Reset via a plain
 * `<Link>` to the query-string-free URL), so the URL half of "state + URL
 * consistency" was already correct before this fix — see the Phase 9
 * report for the visual-state half that wasn't.
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
  batchOptions: Array<{ id: string; name: string; programId: string }>;
}) {
  // Root cause of the Reset defect: Next.js client-side navigation (via the
  // Reset <Link>, or a resubmitted GET form for Apply) re-renders this
  // Server-Component-driven tree with new props, but React reconciles the
  // resulting <select>/<input> elements against the SAME already-mounted
  // DOM nodes (same position, same tag). An uncontrolled field's
  // `defaultValue` is only honored the first time a node is created —
  // updating the prop on a live node does not reapply it — so the visible
  // selection silently survived navigation even after the URL/searchParams
  // (and thus these props) had already gone back to empty.
  //
  // Fix: derive a key from the incoming filter props (sourced from the URL
  // by the parent Server Component) and force every field to remount
  // whenever that key changes — on Reset (props go back to all-empty) and
  // on Apply (props reflect the newly-submitted filters) alike. This is the
  // same "React resets uncontrolled fields" fix already used for
  // useActionState forms elsewhere (enrollment-form.tsx, batch-form.tsx),
  // adapted here for a plain GET-navigation form instead of a Server Action.
  const propsKey = JSON.stringify({ q, studentId, programId, batchId, status });
  const [priorPropsKey, setPriorPropsKey] = useState(propsKey);
  const [generation, setGeneration] = useState(0);
  const [selectedProgramId, setSelectedProgramId] = useState(programId ?? "");
  const [selectedBatchId, setSelectedBatchId] = useState(batchId ?? "");
  if (propsKey !== priorPropsKey) {
    setPriorPropsKey(propsKey);
    setGeneration((g) => g + 1);
    // Program/Batch are controlled (see below) precisely so a Program
    // change can clear an incompatible Batch client-side — controlled
    // fields don't inherit the Fragment-remount fix above (their displayed
    // value always comes from this state, not from `defaultValue`), so
    // they're resynced to the new URL explicitly here instead.
    setSelectedProgramId(programId ?? "");
    setSelectedBatchId(batchId ?? "");
  }

  // Program and Batch are dependent: only offer Batches under the selected
  // Program, and changing Program immediately clears any Batch selection
  // that no longer belongs to it — never left dangling for Apply to submit
  // as an incompatible (programId, batchId) pair.
  const filteredBatchOptions = batchOptions.filter(
    (batch) => !selectedProgramId || batch.programId === selectedProgramId,
  );

  function handleProgramChange(nextProgramId: string) {
    setSelectedProgramId(nextProgramId);
    setSelectedBatchId("");
  }

  return (
    <form
      method="GET"
      action="/admin/enrollments"
      className="flex flex-wrap items-end gap-3"
    >
      <Fragment key={generation}>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="q">Search</Label>
          <Input
            id="q"
            name="q"
            defaultValue={q ?? ""}
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
            value={selectedProgramId}
            onChange={(e) => handleProgramChange(e.target.value)}
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
            value={selectedBatchId}
            onChange={(e) => setSelectedBatchId(e.target.value)}
            className="border-input h-9 rounded-md border bg-transparent px-3 text-sm shadow-xs"
          >
            <option value="">All batches</option>
            {filteredBatchOptions.map((batch) => (
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
      </Fragment>

      <Button type="submit" variant="secondary">
        Apply
      </Button>
      <Button type="button" variant="ghost" asChild>
        <Link href="/admin/enrollments">Reset</Link>
      </Button>
    </form>
  );
}
