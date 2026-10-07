import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AssignmentList } from "@/components/admin/assignments/assignment-list";
import { CreateAssignmentForm } from "@/components/admin/assignments/create-assignment-form";
import type { AssignmentRow } from "@/lib/data/assignments";
import type { AssignmentFormState } from "@/lib/actions/assignments";

type BoundAction = (
  prevState: AssignmentFormState,
  formData: FormData,
) => Promise<AssignmentFormState>;

export function AssignmentsCard({
  assignments,
  action,
  statusAction,
  renderSubmissions,
  trainerOptions,
  moduleOptions,
}: {
  assignments: AssignmentRow[];
  action: BoundAction;
  statusAction: (assignmentId: string) => BoundAction;
  renderSubmissions: (assignment: AssignmentRow) => ReactNode;
  trainerOptions?: Array<{ id: string; firstName: string; lastName: string }>;
  moduleOptions?: Array<{ id: string; title: string }>;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Assignments</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <AssignmentList
          assignments={assignments}
          statusAction={statusAction}
          renderSubmissions={renderSubmissions}
        />
        <CreateAssignmentForm
          action={action}
          trainerOptions={trainerOptions}
          moduleOptions={moduleOptions}
        />
      </CardContent>
    </Card>
  );
}
