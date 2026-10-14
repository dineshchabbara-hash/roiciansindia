import { Badge } from "@/components/ui/badge";
import { formatTimestampAsIstDate } from "@/lib/domain/reports";
import type { PortalAccessState } from "@/lib/domain/accounts";

/** Phase 21C — a login's activation state in one badge. */
export function AccessBadge({ access }: { access: PortalAccessState }) {
  if (access.status === "none")
    return <Badge variant="secondary">No portal access</Badge>;
  if (access.status === "awaiting_activation") {
    return <Badge variant="warning">Awaiting activation</Badge>;
  }
  return (
    <Badge variant="success">
      Active
      {access.lastSignInAt
        ? ` · last sign-in ${formatTimestampAsIstDate(access.lastSignInAt)}`
        : ""}
    </Badge>
  );
}
