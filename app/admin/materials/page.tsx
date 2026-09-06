import { FileText } from "lucide-react";
import { ComingSoon } from "@/components/admin/coming-soon";

export default function MaterialsPage() {
  return (
    <ComingSoon
      title="Materials"
      description="Upload and organize learning materials."
      icon={FileText}
    />
  );
}
