import Link from "next/link";
import {
  UserPlus,
  BookOpen,
  CalendarDays,
  ClipboardList,
  CreditCard,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const QUICK_ACTIONS = [
  { label: "Add Student", href: "/admin/students", icon: UserPlus },
  { label: "Create Program", href: "/admin/programs", icon: BookOpen },
  { label: "Create Batch", href: "/admin/batches", icon: CalendarDays },
  { label: "New Enrollment", href: "/admin/enrollments", icon: ClipboardList },
  { label: "Record Payment", href: "/admin/payments", icon: CreditCard },
] as const;

/**
 * Every action links to that module's real route. None of these modules are
 * built yet, so each route renders the shared ComingSoon page rather than
 * pretending the action works — never a button that does nothing.
 */
export function QuickActions() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Quick Actions</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {QUICK_ACTIONS.map(({ label, href, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
          >
            <Icon className="size-4" aria-hidden="true" />
            {label}
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}
