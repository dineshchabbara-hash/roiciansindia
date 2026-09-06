import { Award } from "lucide-react";
import { ComingSoon } from "@/components/admin/coming-soon";

export default function CertificatesPage() {
  return (
    <ComingSoon
      title="Certificates"
      description="Issue, revoke, and manage completion certificates."
      icon={Award}
    />
  );
}
