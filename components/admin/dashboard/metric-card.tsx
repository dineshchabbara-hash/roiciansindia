import type { LucideIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function MetricCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  icon: LucideIcon;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-muted-foreground text-sm font-medium">
          {label}
        </CardTitle>
        <Icon className="text-muted-foreground size-4" aria-hidden="true" />
      </CardHeader>
      <CardContent>
        {/* Explicit "0" must render as the string zero, never a blank —
            `value ?? "0"` at the call site guards this; nothing here
            treats a falsy 0 as "no value". */}
        <div className="text-2xl font-bold">{value}</div>
      </CardContent>
    </Card>
  );
}
