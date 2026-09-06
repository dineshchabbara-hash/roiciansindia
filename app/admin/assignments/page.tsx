import { FileCheck } from "lucide-react";
import { ComingSoon } from "@/components/admin/coming-soon";

export default function AssignmentsPage() {
  return (
    <ComingSoon
      title="Assignments"
      description="Create assignments and review student submissions."
      icon={FileCheck}
    />
  );
}
