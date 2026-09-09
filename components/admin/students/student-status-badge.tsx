import { Badge } from "@/components/ui/badge";

export function StudentStatusBadge({
  status,
}: {
  status: "active" | "inactive" | "archived";
}) {
  const variant =
    status === "active" ? "success" : status === "inactive" ? "warning" : "secondary";
  return <Badge variant={variant}>{status}</Badge>;
}
