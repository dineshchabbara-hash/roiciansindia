import { Badge } from "@/components/ui/badge";
import type { BatchStatus } from "@/lib/domain/batches";

const VARIANTS: Record<
  BatchStatus,
  "default" | "secondary" | "destructive" | "outline" | "success" | "warning"
> = {
  draft: "outline",
  upcoming: "secondary",
  active: "success",
  completed: "default",
  cancelled: "destructive",
  archived: "warning",
};

export function BatchStatusBadge({ status }: { status: BatchStatus }) {
  return <Badge variant={VARIANTS[status]}>{status}</Badge>;
}
