import { GraduationCap } from "lucide-react";
import { ComingSoon } from "@/components/admin/coming-soon";

export default function TrainersPage() {
  return (
    <ComingSoon
      title="Trainers"
      description="Invite and manage trainer accounts and assignments."
      icon={GraduationCap}
    />
  );
}
