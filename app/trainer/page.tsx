import { redirect } from "next/navigation";
import { getCurrentUserContext } from "@/lib/auth/session";
import { PortalPlaceholderShell } from "@/components/public/portal-placeholder-shell";

export const dynamic = "force-dynamic";

export default async function TrainerHome() {
  const user = await getCurrentUserContext();
  if (!user) {
    redirect("/login/trainer");
  }
  return <PortalPlaceholderShell portalName="Trainer Portal" user={user} />;
}
