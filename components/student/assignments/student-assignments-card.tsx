import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StudentAssignmentList } from "@/components/student/assignments/student-assignment-list";
import type { MyAssignmentRow } from "@/lib/data/student-portal";

export function StudentAssignmentsCard({
  assignments,
  enrollmentId,
}: {
  assignments: MyAssignmentRow[];
  enrollmentId: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Assignments</CardTitle>
      </CardHeader>
      <CardContent>
        <StudentAssignmentList assignments={assignments} enrollmentId={enrollmentId} />
      </CardContent>
    </Card>
  );
}
