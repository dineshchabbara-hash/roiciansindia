import { Badge } from "@/components/ui/badge";
import type { ClassSessionStatus } from "@/lib/domain/class-sessions";

const VARIANTS: Record<
  ClassSessionStatus,
  "default" | "secondary" | "destructive" | "outline" | "success" | "warning"
> = {
  scheduled: "secondary",
  completed: "success",
  cancelled: "destructive",
  rescheduled: "warning",
};

export function ClassSessionStatusBadge({ status }: { status: ClassSessionStatus }) {
  return <Badge variant={VARIANTS[status]}>{status}</Badge>;
}
