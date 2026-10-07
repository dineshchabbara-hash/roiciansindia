import { getSubmissionsForAssignment } from "@/lib/data/assignments";
import { reviewSubmissionAsAdminAction } from "@/lib/actions/assignments";
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
 * Lists submissions that exist for one Assignment (a Student with no
 * submission row simply never appears here — there is no synthesized
 * "not submitted" placeholder row, since this phase builds no full batch
 * roster cross-reference; see the Phase 16 report's own documented scope
 * decision). is_admin_or_super() already grants Admin unrestricted read of
 * every submission, so this list is complete for Admin regardless.
 */
export async function SubmissionsSection({
  assignmentId,
  batchId,
  maxMarks,
}: {
  assignmentId: string;
  batchId: string;
  maxMarks: number | null;
}) {
  const result = await getSubmissionsForAssignment(assignmentId);
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
            action={reviewSubmissionAsAdminAction.bind(
              null,
              submission.id,
              assignmentId,
              batchId,
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
