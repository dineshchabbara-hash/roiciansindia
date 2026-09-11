import { Badge } from "@/components/ui/badge";
import type { ProgramStatus } from "@/lib/domain/programs";

export function ProgramStatusBadge({ status }: { status: ProgramStatus }) {
  const variant =
    status === "active"
      ? "success"
      : status === "inactive"
        ? "warning"
        : status === "archived"
          ? "secondary"
          : "outline";
  return <Badge variant={variant}>{status}</Badge>;
}
