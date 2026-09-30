import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { MyBatchRow } from "@/lib/data/trainer-portal";

/**
 * Trainer-facing batch summary — safe projection only (FR-51/FR-54): batch
 * name/code(via program), program, dates, delivery mode, schedule already
 * on the record. Never a fee/discount/payment field — lib/data/trainer-
 * portal.ts's own query never selects any Program pricing column at all.
 */
export function TrainerBatchCard({ batch }: { batch: MyBatchRow }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div>
          <CardTitle className="text-base">{batch.name}</CardTitle>
          <p className="text-muted-foreground text-xs">
            {batch.programName} ({batch.programCode})
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Badge variant="outline" className="capitalize">
            {batch.status.replace("_", " ")}
          </Badge>
          {batch.isPrimary && <Badge variant="secondary">Primary</Badge>}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
          <div>
            <p className="text-muted-foreground text-xs">Start date</p>
            <p>{batch.startDate}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">End date</p>
            <p>{batch.expectedEndDate ?? "—"}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Delivery mode</p>
            <p className="capitalize">{batch.deliveryMode?.replace("_", " ") ?? "—"}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Schedule</p>
            <p>
              {batch.daysOfWeek.length > 0 ? batch.daysOfWeek.join(", ") : "—"}
              {batch.startTime && batch.endTime
                ? ` · ${batch.startTime}–${batch.endTime}`
                : ""}
            </p>
          </div>
        </div>
        <Link
          href={`/trainer/batches/${batch.id}`}
          className="text-primary text-sm hover:underline"
        >
          View details
        </Link>
      </CardContent>
    </Card>
  );
}
