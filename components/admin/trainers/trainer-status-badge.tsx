import { Badge } from "@/components/ui/badge";

export function TrainerStatusBadge({ status }: { status: "active" | "inactive" }) {
  const variant = status === "active" ? "success" : "warning";
  return <Badge variant={variant}>{status}</Badge>;
}
