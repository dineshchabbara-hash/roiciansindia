import { ForgotPasswordForm } from "@/components/public/forgot-password-form";
import { AuthCard } from "@/components/public/auth-card";

export default function ForgotPassword() {
  return (
    <AuthCard
      title="Forgot password"
      description="Enter your account email and we'll send you a reset link."
    >
      <ForgotPasswordForm />
    </AuthCard>
  );
}
