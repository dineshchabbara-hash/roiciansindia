import { Badge } from "@/components/ui/badge";
import {
  STATUS_BADGE_VARIANTS,
  STATUS_LABELS,
  type WebsitePageStatus,
} from "@/lib/domain/website-admin";

export function PageStatusBadge({ status }: { status: WebsitePageStatus }) {
  return <Badge variant={STATUS_BADGE_VARIANTS[status]}>{STATUS_LABELS[status]}</Badge>;
}
