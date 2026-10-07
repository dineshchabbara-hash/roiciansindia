import { VerifyCertificateForm } from "@/components/public/verify-certificate-form";
import { AuthCard } from "@/components/public/auth-card";

export default function VerifyCertificate() {
  return (
    <AuthCard
      title="Verify a certificate"
      description="Enter the certificate number exactly as it appears on the document."
    >
      <VerifyCertificateForm />
    </AuthCard>
  );
}
