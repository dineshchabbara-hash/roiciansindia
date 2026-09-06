import { ClipboardList } from "lucide-react";
import { ComingSoon } from "@/components/admin/coming-soon";

export default function EnrollmentsPage() {
  return (
    <ComingSoon
      title="Enrollments"
      description="Manage student enrollments, fees, and status."
      icon={ClipboardList}
    />
  );
}
