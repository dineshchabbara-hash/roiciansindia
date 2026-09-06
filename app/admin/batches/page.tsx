import { CalendarDays } from "lucide-react";
import { ComingSoon } from "@/components/admin/coming-soon";

export default function BatchesPage() {
  return (
    <ComingSoon
      title="Batches"
      description="Schedule and manage batches for each program."
      icon={CalendarDays}
    />
  );
}
