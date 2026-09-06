import { UserPlus } from "lucide-react";
import { ComingSoon } from "@/components/admin/coming-soon";

export default function LeadsPage() {
  return (
    <ComingSoon
      title="Leads"
      description="Track and follow up on inquiries from the public site."
      icon={UserPlus}
    />
  );
}
