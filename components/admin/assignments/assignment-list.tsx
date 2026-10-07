import { Suspense, type ReactNode } from "react";
import type { AssignmentRow } from "@/lib/data/assignments";
import type { AssignmentFormState } from "@/lib/actions/assignments";
import { AssignmentFileViewButton } from "@/components/admin/assignments/assignment-file-view-button";
import { AssignmentStatusControl } from "@/components/admin/assignments/assignment-status-control";

type BoundAction = (
  prevState: AssignmentFormState,
  formData: FormData,
) => Promise<AssignmentFormState>;

/**
 * Generic assignment list — the parent page supplies `statusAction` (role-
 * specific: updateAssignmentStatusAction for Admin,
 * updateMyAssignmentStatusAction for Trainer) and `renderSubmissions` (an
 * async server-component render function, since Admin/Trainer each fetch
 * submissions through their own data-access function), so this one
 * component serves both roles without duplicating the list markup.
 */
export function AssignmentList({
  assignments,
  statusAction,
  renderSubmissions,
}: {
  assignments: AssignmentRow[];
  statusAction: (assignmentId: string) => BoundAction;
  renderSubmissions: (assignment: AssignmentRow) => ReactNode;
}) {
  if (assignments.length === 0) {
    return <p className="text-muted-foreground text-sm">No assignments created yet.</p>;
  }

  return (
    <ul className="flex flex-col gap-2">
      {assignments.map((assignment) => (
        <li key={assignment.id} className="border-b pb-2 text-sm last:border-0 last:pb-0">
          <details>
            <summary className="flex cursor-pointer items-center justify-between gap-3">
              <span className="min-w-0 truncate font-medium">{assignment.title}</span>
              <span className="text-muted-foreground shrink-0 text-xs">
                Due {assignment.dueDate}
                {assignment.trainerName ? ` · ${assignment.trainerName}` : ""}
                {assignment.moduleTitle ? ` · Module: ${assignment.moduleTitle}` : ""}
                {` · ${assignment.status}`}
              </span>
            </summary>
            <div className="mt-3 flex flex-col gap-3 pl-1">
              {assignment.description && (
                <p className="text-muted-foreground text-xs whitespace-pre-wrap">
                  {assignment.description}
                </p>
              )}
              <div className="flex items-center gap-2">
                {assignment.attachmentPath && (
                  <AssignmentFileViewButton
                    kind="attachment"
                    id={assignment.id}
                    label={assignment.attachmentDisplayName ?? "View attachment"}
                  />
                )}
                <AssignmentStatusControl
                  action={statusAction(assignment.id)}
                  currentStatus={assignment.status}
                />
              </div>
              <div>
                <p className="mb-1 text-xs font-medium">Submissions</p>
                <Suspense
                  fallback={<p className="text-muted-foreground text-xs">Loading…</p>}
                >
                  {renderSubmissions(assignment)}
                </Suspense>
              </div>
            </div>
          </details>
        </li>
      ))}
    </ul>
  );
}
