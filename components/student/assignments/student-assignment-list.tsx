import type { MyAssignmentRow } from "@/lib/data/student-portal";
import { AssignmentFileViewButton } from "@/components/admin/assignments/assignment-file-view-button";
import { StudentSubmitAssignmentForm } from "@/components/student/assignments/student-submit-assignment-form";

const STATUS_LABELS: Record<string, string> = {
  not_submitted: "Not submitted",
  submitted: "Submitted",
  late: "Late",
  reviewed: "Reviewed",
  resubmission_requested: "Resubmission requested",
};

/**
 * Never shows other Students, Trainer-internal fields, Admin controls, or
 * financial data (REQUIREMENTS §19 of the Phase 16 brief) — mySubmission
 * is this caller's own row only (lib/data/student-portal.ts's own
 * getMyAssignmentsForEnrollment), there is no roster/other-student data on
 * this type at all for a Student page to accidentally render.
 */
export function StudentAssignmentList({
  assignments,
  enrollmentId,
}: {
  assignments: MyAssignmentRow[];
  enrollmentId: string;
}) {
  if (assignments.length === 0) {
    return <p className="text-muted-foreground text-sm">No assignments yet.</p>;
  }

  return (
    <ul className="flex flex-col gap-2">
      {assignments.map((assignment) => {
        const status = assignment.mySubmission?.status ?? "not_submitted";
        const canEdit = status !== "reviewed";
        return (
          <li
            key={assignment.id}
            className="border-b pb-2 text-sm last:border-0 last:pb-0"
          >
            <details>
              <summary className="flex cursor-pointer items-center justify-between gap-3">
                <span className="min-w-0 truncate font-medium">{assignment.title}</span>
                <span className="text-muted-foreground shrink-0 text-xs">
                  Due {assignment.dueDate}
                  {` · ${STATUS_LABELS[status] ?? status}`}
                </span>
              </summary>
              <div className="mt-3 flex flex-col gap-3 pl-1">
                {assignment.description && (
                  <p className="text-muted-foreground text-xs whitespace-pre-wrap">
                    {assignment.description}
                  </p>
                )}
                {assignment.attachmentPath && (
                  <AssignmentFileViewButton
                    kind="attachment"
                    id={assignment.id}
                    label={assignment.attachmentDisplayName ?? "View attachment"}
                  />
                )}

                {assignment.mySubmission && (
                  <div className="flex flex-col gap-1 text-xs">
                    {assignment.mySubmission.fileDisplayName && (
                      <AssignmentFileViewButton
                        kind="submission"
                        id={assignment.mySubmission.id}
                        label={assignment.mySubmission.fileDisplayName}
                      />
                    )}
                    {(assignment.mySubmission.marks !== null ||
                      assignment.mySubmission.trainerFeedback) && (
                      <p className="text-muted-foreground">
                        {assignment.mySubmission.marks !== null
                          ? `Marks: ${assignment.mySubmission.marks}`
                          : null}
                        {assignment.mySubmission.marks !== null &&
                        assignment.mySubmission.trainerFeedback
                          ? " · "
                          : null}
                        {assignment.mySubmission.trainerFeedback
                          ? `Feedback: ${assignment.mySubmission.trainerFeedback}`
                          : null}
                      </p>
                    )}
                  </div>
                )}

                {canEdit ? (
                  <StudentSubmitAssignmentForm
                    assignmentId={assignment.id}
                    enrollmentId={enrollmentId}
                    currentTextResponse={assignment.mySubmission?.textResponse ?? null}
                    hasExistingFile={!!assignment.mySubmission?.fileDisplayName}
                  />
                ) : (
                  <p className="text-muted-foreground text-xs">
                    This submission has been reviewed. Ask your trainer to request a
                    resubmission if you need to change it.
                  </p>
                )}
              </div>
            </details>
          </li>
        );
      })}
    </ul>
  );
}
