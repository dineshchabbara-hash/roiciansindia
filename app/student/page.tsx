import { redirect } from "next/navigation";
import { getCurrentUserContext } from "@/lib/auth/session";
import { PortalPlaceholderShell } from "@/components/public/portal-placeholder-shell";

export const dynamic = "force-dynamic";

export default async function StudentHome() {
  const user = await getCurrentUserContext();
  if (!user) {
    redirect("/login/student");
  }
  return <PortalPlaceholderShell portalName="Student Portal" user={user} />;
}
