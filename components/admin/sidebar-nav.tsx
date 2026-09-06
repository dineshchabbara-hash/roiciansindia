"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ADMIN_NAV_ITEMS, getActiveNavItem } from "@/lib/domain/navigation";
import { cn } from "@/lib/utils";

/**
 * The nav list itself, shared between the fixed desktop sidebar and the
 * mobile drawer (MobileNav) so active-state logic lives in exactly one
 * place. `onNavigate` lets the mobile drawer close itself after a link is
 * clicked — the desktop sidebar simply doesn't pass it.
 */
export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const activeItem = getActiveNavItem(pathname);

  return (
    <nav aria-label="Admin navigation" className="flex flex-col gap-1 p-3">
      {ADMIN_NAV_ITEMS.map((item) => {
        const isActive = activeItem?.href === item.href;
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              "focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none",
              isActive
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            <Icon className="size-4 shrink-0" aria-hidden="true" />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
