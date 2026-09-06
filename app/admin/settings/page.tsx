import { Settings } from "lucide-react";
import { ComingSoon } from "@/components/admin/coming-soon";

export default function SettingsPage() {
  return (
    <ComingSoon
      title="Settings"
      description="Company branding, tax, numbering, and notification settings."
      icon={Settings}
    />
  );
}
