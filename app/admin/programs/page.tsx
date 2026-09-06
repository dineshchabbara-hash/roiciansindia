import { BookOpen } from "lucide-react";
import { ComingSoon } from "@/components/admin/coming-soon";

export default function ProgramsPage() {
  return (
    <ComingSoon
      title="Programs"
      description="Create and manage the course/program catalog."
      icon={BookOpen}
    />
  );
}
