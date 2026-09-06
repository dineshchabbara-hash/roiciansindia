import { ResetPasswordForm } from "@/components/public/reset-password-form";
import { AuthCard } from "@/components/public/auth-card";

export default function ResetPassword() {
  return (
    <AuthCard
      title="Choose a new password"
      description="This link can only be used once."
    >
      <ResetPasswordForm />
    </AuthCard>
  );
}
