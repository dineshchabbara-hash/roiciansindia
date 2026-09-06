import { CreditCard } from "lucide-react";
import { ComingSoon } from "@/components/admin/coming-soon";

export default function PaymentsPage() {
  return (
    <ComingSoon
      title="Payments"
      description="Record offline payments and review online transactions."
      icon={CreditCard}
    />
  );
}
