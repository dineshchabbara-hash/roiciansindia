import { redirect } from "next/navigation";
import { getCurrentUserContext } from "@/lib/auth/session";
import { canAccessRouteGroup, roleHomePath } from "@/lib/domain/rbac";

// Every route under this layout depends on the caller's session/role and
// must never be statically prerendered — force-dynamic is the documented
// Next.js escape hatch for exactly that, and removes any ambiguity around
// whether the framework's automatic dynamic-API detection kicks in for a
// nested async call chain like getCurrentUserContext().
export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUserContext();

  if (!user) {
    redirect("/login/admin");
  }
  if (!canAccessRouteGroup(user.role, "admin")) {
    redirect(roleHomePath(user.role));
  }

  return children;
}
