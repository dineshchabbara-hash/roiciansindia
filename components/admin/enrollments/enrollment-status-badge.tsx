import { Badge } from "@/components/ui/badge";
import type { EnrollmentStatus } from "@/lib/domain/enrollments";

const VARIANTS: Record<
  EnrollmentStatus,
  "default" | "secondary" | "destructive" | "outline" | "success" | "warning"
> = {
  lead: "outline",
  applicant: "outline",
  enrolled: "secondary",
  active: "success",
  on_hold: "warning",
  completed: "default",
  withdrawn: "destructive",
  cancelled: "destructive",
};

export function EnrollmentStatusBadge({ status }: { status: EnrollmentStatus }) {
  return <Badge variant={VARIANTS[status]}>{status.replace("_", " ")}</Badge>;
}
