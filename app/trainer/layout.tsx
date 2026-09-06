import { redirect } from "next/navigation";
import { getCurrentUserContext } from "@/lib/auth/session";
import { canAccessRouteGroup, roleHomePath } from "@/lib/domain/rbac";

// See app/admin/layout.tsx for why this is forced dynamic.
export const dynamic = "force-dynamic";

export default async function TrainerLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUserContext();

  if (!user) {
    redirect("/login/trainer");
  }
  if (!canAccessRouteGroup(user.role, "trainer")) {
    redirect(roleHomePath(user.role));
  }

  return children;
}
