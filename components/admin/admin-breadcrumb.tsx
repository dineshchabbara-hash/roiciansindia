"use client";

import { usePathname } from "next/navigation";
import { getActiveNavItem } from "@/lib/domain/navigation";

export function AdminBreadcrumb() {
  const pathname = usePathname();
  const activeItem = getActiveNavItem(pathname);

  return (
    <nav aria-label="Breadcrumb" className="text-muted-foreground text-sm">
      <ol className="flex items-center gap-1.5">
        <li>Admin</li>
        {activeItem && activeItem.href !== "/admin" && (
          <>
            <li aria-hidden="true">/</li>
            <li className="text-foreground font-medium">{activeItem.label}</li>
          </>
        )}
      </ol>
    </nav>
  );
}
