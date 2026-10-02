"use client";

import { Fragment, useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  markAttendanceAction,
  type AttendanceMarkFormState,
} from "@/lib/actions/attendance";
import { ATTENDANCE_STATUSES, type AttendanceStatus } from "@/lib/domain/attendance";
import type { AttendanceRosterRow } from "@/lib/data/attendance";

const initialState: AttendanceMarkFormState = {};

const STATUS_LABELS: Record<AttendanceStatus, string> = {
  present: "Present",
  absent: "Absent",
  late: "Late",
  excused: "Excused",
};

/**
 * One row per student eligible for this Class Session (enrolled in its own
 * Batch — see getEligibleRosterForClassSession's own comment). Leaving a
 * row's status blank ("Not marked") submits nothing for that student — it
 * is never forced to a default status, so a partially-marked roster can be
 * finished later without re-submitting rows already marked correctly.
 * Mirrors components/admin/class-sessions/class-session-form.tsx's own
 * `generation`-keyed remount so the form's (uncontrolled) defaultValues
 * re-sync with the server's latest roster after each save.
 */
export function AttendanceRosterForm({
  batchId,
  sessionId,
  roster,
}: {
  batchId: string;
  sessionId: string;
  roster: AttendanceRosterRow[];
}) {
  const boundAction = markAttendanceAction.bind(null, batchId, sessionId);
  const [state, formAction, isPending] = useActionState(boundAction, initialState);

  const [priorState, setPriorState] = useState(state);
  const [generation, setGeneration] = useState(0);
  if (state !== priorState) {
    setPriorState(state);
    setGeneration((g) => g + 1);
  }

  if (roster.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No students are enrolled in this batch yet.
      </p>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <Fragment key={generation}>
        <ul className="flex flex-col gap-3">
          {roster.map((row) => (
            <li
              key={row.enrollmentId}
              className="flex flex-col gap-2 border-b pb-3 last:border-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {row.firstName} {row.lastName}
                </p>
                <p className="text-muted-foreground truncate text-xs">
                  {row.studentCode}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <select
                  name={`status__${row.enrollmentId}`}
                  defaultValue={row.status ?? ""}
                  aria-label={`Attendance status for ${row.firstName} ${row.lastName}`}
                  className="border-input h-9 rounded-md border bg-transparent px-2 text-sm shadow-xs"
                >
                  <option value="">Not marked</option>
                  {ATTENDANCE_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {STATUS_LABELS[status]}
                    </option>
                  ))}
                </select>
                <Input
                  name={`notes__${row.enrollmentId}`}
                  defaultValue={row.notes ?? ""}
                  placeholder="Notes (optional)"
                  className="w-40"
                  aria-label={`Attendance notes for ${row.firstName} ${row.lastName}`}
                />
              </div>
            </li>
          ))}
        </ul>
      </Fragment>

      {state.formError && (
        <p role="alert" className="text-destructive text-sm">
          {state.formError}
        </p>
      )}
      {state.success && state.summary && (
        <p className="text-sm text-green-700 dark:text-green-400">
          Saved — {state.summary.marked} marked, {state.summary.corrected} corrected.
        </p>
      )}

      <Button type="submit" disabled={isPending} className="w-fit">
        {isPending ? "Saving..." : "Save attendance"}
      </Button>
    </form>
  );
}
