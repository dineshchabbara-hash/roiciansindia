import { redirect } from "next/navigation";
import { getCurrentUserContext } from "@/lib/auth/session";
import { PortalPlaceholderShell } from "@/components/public/portal-placeholder-shell";

export const dynamic = "force-dynamic";

export default async function AdminHome() {
  // The layout has already verified the session/role; this defensive check
  // (rather than a non-null assertion) is defense in depth, not a
  // duplicate of the layout's authorization — a null result here is always
  // treated as "not authenticated," never assumed away.
  const user = await getCurrentUserContext();
  if (!user) {
    redirect("/login/admin");
  }
  return <PortalPlaceholderShell portalName="Admin Portal" user={user} />;
}
