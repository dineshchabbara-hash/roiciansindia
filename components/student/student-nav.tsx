"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { STUDENT_NAV_ITEMS, getActiveStudentNavItem } from "@/lib/domain/navigation";
import { cn } from "@/lib/utils";

/**
 * Same active-state pattern as components/admin/sidebar-nav.tsx, over the
 * Student Portal's own (much smaller) STUDENT_NAV_ITEMS list.
 */
export function StudentNav({
  unreadNotificationCount = 0,
}: {
  unreadNotificationCount?: number;
}) {
  const pathname = usePathname();
  const activeItem = getActiveStudentNavItem(pathname);

  return (
    <nav
      aria-label="Student navigation"
      className="flex flex-row gap-1 overflow-x-auto p-2 md:flex-col md:p-3"
    >
      {STUDENT_NAV_ITEMS.map((item) => {
        const isActive = activeItem?.href === item.href;
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors",
              "focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none",
              isActive
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            <Icon className="size-4 shrink-0" aria-hidden="true" />
            <span>{item.label}</span>
            {item.href === "/student/notifications" && unreadNotificationCount > 0 && (
              <>
                <span
                  aria-hidden="true"
                  className="bg-destructive ml-auto rounded-full px-1.5 text-xs leading-5 text-white"
                >
                  {unreadNotificationCount}
                </span>
                <span className="sr-only">, {unreadNotificationCount} unread</span>
              </>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
