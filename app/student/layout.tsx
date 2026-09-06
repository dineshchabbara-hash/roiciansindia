import { redirect } from "next/navigation";
import { getCurrentUserContext } from "@/lib/auth/session";
import { canAccessRouteGroup, roleHomePath } from "@/lib/domain/rbac";

// See app/admin/layout.tsx for why this is forced dynamic.
export const dynamic = "force-dynamic";

export default async function StudentLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUserContext();

  if (!user) {
    redirect("/login/student");
  }
  if (!canAccessRouteGroup(user.role, "student")) {
    redirect(roleHomePath(user.role));
  }

  return children;
}
