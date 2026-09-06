import type { LucideIcon } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * Shared placeholder for every Admin nav item not yet built
 * (IMPLEMENTATION_PLAN.md Phases 5+ replace these one module at a time).
 * Never a fake/functional-looking UI — clearly labeled, no data, no forms.
 */
export function ComingSoon({
  title,
  description,
  icon: Icon,
}: {
  title: string;
  description: string;
  icon: LucideIcon;
}) {
  return (
    <div className="flex flex-1 items-center justify-center">
      <Card className="w-full max-w-md text-center">
        <CardHeader className="items-center">
          <div className="bg-muted mb-2 flex size-12 items-center justify-center rounded-full">
            <Icon className="text-muted-foreground size-6" aria-hidden="true" />
          </div>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">
            This module is coming soon — see{" "}
            <code className="bg-muted rounded px-1 py-0.5 font-mono text-xs">
              IMPLEMENTATION_PLAN.md
            </code>{" "}
            for its build phase.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
