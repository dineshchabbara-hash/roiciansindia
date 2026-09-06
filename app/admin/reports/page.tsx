import { BarChart3 } from "lucide-react";
import { ComingSoon } from "@/components/admin/coming-soon";

export default function ReportsPage() {
  return (
    <ComingSoon
      title="Reports"
      description="Student, enrollment, payment, and attendance reports."
      icon={BarChart3}
    />
  );
}
