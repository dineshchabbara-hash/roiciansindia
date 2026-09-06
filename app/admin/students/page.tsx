import { Users } from "lucide-react";
import { ComingSoon } from "@/components/admin/coming-soon";

export default function StudentsPage() {
  return (
    <ComingSoon
      title="Students"
      description="Add, search, and manage student records."
      icon={Users}
    />
  );
}
