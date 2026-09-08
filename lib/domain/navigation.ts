import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  Users,
  GraduationCap,
  BookOpen,
  CalendarDays,
  ClipboardList,
  CreditCard,
  CheckSquare,
  FileText,
  FileCheck,
  Award,
  UserPlus,
  BarChart3,
  Settings,
} from "lucide-react";

/**
 * Single source of truth for Admin sidebar/mobile-nav/breadcrumb structure.
 * Pure data — no React rendering here — so it's usable from Server and
 * Client Components alike and fully unit-testable. `implemented: false`
 * routes render the shared ComingSoon page rather than real CRUD
 * (IMPLEMENTATION_PLAN.md Phases 5+ build these out one at a time).
 */
export type AdminNavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  implemented: boolean;
};

export const ADMIN_NAV_ITEMS: AdminNavItem[] = [
  { label: "Dashboard", href: "/admin", icon: LayoutDashboard, implemented: true },
  { label: "Students", href: "/admin/students", icon: Users, implemented: true },
  { label: "Trainers", href: "/admin/trainers", icon: GraduationCap, implemented: false },
  { label: "Programs", href: "/admin/programs", icon: BookOpen, implemented: false },
  { label: "Batches", href: "/admin/batches", icon: CalendarDays, implemented: false },
  {
    label: "Enrollments",
    href: "/admin/enrollments",
    icon: ClipboardList,
    implemented: false,
  },
  { label: "Payments", href: "/admin/payments", icon: CreditCard, implemented: false },
  {
    label: "Attendance",
    href: "/admin/attendance",
    icon: CheckSquare,
    implemented: false,
  },
  { label: "Materials", href: "/admin/materials", icon: FileText, implemented: false },
  {
    label: "Assignments",
    href: "/admin/assignments",
    icon: FileCheck,
    implemented: false,
  },
  { label: "Certificates", href: "/admin/certificates", icon: Award, implemented: false },
  { label: "Leads", href: "/admin/leads", icon: UserPlus, implemented: false },
  { label: "Reports", href: "/admin/reports", icon: BarChart3, implemented: false },
  { label: "Settings", href: "/admin/settings", icon: Settings, implemented: false },
];

/**
 * Which nav item a given pathname belongs to, for sidebar active-state and
 * breadcrumbs. Longest-href-match wins so a future nested route (e.g.
 * `/admin/students/123`) still resolves to "Students" without editing this
 * function again.
 */
export function getActiveNavItem(pathname: string): AdminNavItem | undefined {
  const matches = ADMIN_NAV_ITEMS.filter(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  );
  if (matches.length === 0) return undefined;
  return matches.reduce((longest, item) =>
    item.href.length > longest.href.length ? item : longest,
  );
}
