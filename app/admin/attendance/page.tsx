import { CheckSquare } from "lucide-react";
import { ComingSoon } from "@/components/admin/coming-soon";

export default function AttendancePage() {
  return (
    <ComingSoon
      title="Attendance"
      description="Review and adjust attendance across all batches."
      icon={CheckSquare}
    />
  );
}
