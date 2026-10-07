import { getMySubmissionsForAssignment } from "@/lib/data/trainer-portal";
import { reviewMySubmissionAction } from "@/lib/actions/trainer-assignments";
import { AssignmentFileViewButton } from "@/components/admin/assignments/assignment-file-view-button";
import { SubmissionReviewForm } from "@/components/admin/assignments/submission-review-form";

const STATUS_LABELS: Record<string, string> = {
  not_submitted: "Not submitted",
  submitted: "Submitted",
  late: "Late",
  reviewed: "Reviewed",
  resubmission_requested: "Resubmission requested",
};

/**
 * Trainer's own view of one Assignment's submissions —
 * getMySubmissionsForAssignment (lib/data/trainer-portal.ts) re-verifies
 * the assignment belongs to one of the caller's own assigned batches
 * before even querying, and assignment_submissions_select_trainer RLS
 * independently scopes the rows themselves — a Trainer unrelated to this
 * batch can reach neither this component nor any row through it.
 */
export async function TrainerSubmissionsSection({
  batchId,
  assignmentId,
  maxMarks,
}: {
  batchId: string;
  assignmentId: string;
  maxMarks: number | null;
}) {
  const result = await getMySubmissionsForAssignment(batchId, assignmentId);
  if (!result.ok) {
    return (
      <p role="alert" className="text-destructive text-xs">
        {result.error}
      </p>
    );
  }

  if (result.data.length === 0) {
    return <p className="text-muted-foreground text-xs">No submissions yet.</p>;
  }

  return (
    <ul className="flex flex-col gap-3">
      {result.data.map((submission) => (
        <li key={submission.id} className="flex flex-col gap-2 border-t pt-2 text-xs">
          <div className="flex items-center justify-between gap-3">
            <span className="font-medium">
              {submission.studentName ?? "Unknown student"}
              {submission.studentCode ? ` (${submission.studentCode})` : ""}
            </span>
            <span className="text-muted-foreground capitalize">
              {STATUS_LABELS[submission.status] ?? submission.status}
            </span>
          </div>
          {submission.textResponse && (
            <p className="whitespace-pre-wrap">{submission.textResponse}</p>
          )}
          {submission.filePath && (
            <AssignmentFileViewButton
              kind="submission"
              id={submission.id}
              label={submission.fileDisplayName ?? "View file"}
            />
          )}
          {(submission.marks !== null || submission.trainerFeedback) && (
            <p className="text-muted-foreground">
              {submission.marks !== null ? `Marks: ${submission.marks}` : null}
              {submission.marks !== null && submission.trainerFeedback ? " · " : null}
              {submission.trainerFeedback
                ? `Feedback: ${submission.trainerFeedback}`
                : null}
            </p>
          )}
          <SubmissionReviewForm
            action={reviewMySubmissionAction.bind(
              null,
              batchId,
              assignmentId,
              submission.id,
            )}
            maxMarks={maxMarks}
            currentMarks={submission.marks}
            currentFeedback={submission.trainerFeedback}
          />
        </li>
      ))}
    </ul>
  );
}
