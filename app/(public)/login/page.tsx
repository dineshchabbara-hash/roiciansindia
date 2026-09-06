import { LoginPage } from "@/components/public/login-page";

export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ passwordUpdated?: string }>;
}) {
  const { passwordUpdated } = await searchParams;

  return (
    <LoginPage
      title="Sign in"
      description="Enter your email and password to continue."
      notice={
        passwordUpdated ? "Your password has been updated. Please sign in." : undefined
      }
    />
  );
}
