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
  User,
  Bell,
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
  {
    label: "Notifications",
    href: "/admin/notifications",
    icon: Bell,
    implemented: false,
  },
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

/**
 * Single source of truth for the Student Portal's own nav (Phase 10) — a
 * separate, much smaller list from ADMIN_NAV_ITEMS above, not a filtered
 * view of it: the Student Portal's routes, labels, and icons have nothing
 * in common with the Admin sidebar. No `implemented: false` entries here —
 * per the Phase 10 report, unbuilt Student-facing features (class
 * schedules, attendance) are shown as inert placeholder content on the
 * dashboard itself, not as clickable nav items to a page that doesn't exist
 * yet.
 */
export type StudentNavItem = { label: string; href: string; icon: LucideIcon };

export const STUDENT_NAV_ITEMS: StudentNavItem[] = [
  { label: "Dashboard", href: "/student", icon: LayoutDashboard },
  { label: "My Enrollments", href: "/student/enrollments", icon: ClipboardList },
  { label: "Notifications", href: "/student/notifications", icon: Bell },
  { label: "My Profile", href: "/student/profile", icon: User },
];

/** Same longest-match logic as getActiveNavItem, over STUDENT_NAV_ITEMS. */
export function getActiveStudentNavItem(pathname: string): StudentNavItem | undefined {
  const matches = STUDENT_NAV_ITEMS.filter(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  );
  if (matches.length === 0) return undefined;
  return matches.reduce((longest, item) =>
    item.href.length > longest.href.length ? item : longest,
  );
}

/**
 * Single source of truth for the Trainer Portal's own nav (Phase 11) — a
 * separate, much smaller list, same reasoning as STUDENT_NAV_ITEMS above.
 * No "Assignments"/"Attendance"/"Materials" entries here even though
 * REQUIREMENTS.md's Trainer Portal section eventually covers them (FR-52/
 * FR-53) — those are Phase 12/13/17/18 features with no backend yet; per
 * the Phase 11 report, unbuilt Trainer-facing features are placeholder
 * dashboard content, not clickable nav items to pages that don't exist.
 */
export type TrainerNavItem = { label: string; href: string; icon: LucideIcon };

export const TRAINER_NAV_ITEMS: TrainerNavItem[] = [
  { label: "Dashboard", href: "/trainer", icon: LayoutDashboard },
  { label: "My Batches", href: "/trainer/batches", icon: CalendarDays },
  { label: "My Students", href: "/trainer/students", icon: Users },
  { label: "Notifications", href: "/trainer/notifications", icon: Bell },
  { label: "My Profile", href: "/trainer/profile", icon: User },
];

/** Same longest-match logic as getActiveNavItem, over TRAINER_NAV_ITEMS. */
export function getActiveTrainerNavItem(pathname: string): TrainerNavItem | undefined {
  const matches = TRAINER_NAV_ITEMS.filter(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  );
  if (matches.length === 0) return undefined;
  return matches.reduce((longest, item) =>
    item.href.length > longest.href.length ? item : longest,
  );
}
