import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatPaiseAsINR } from "@/lib/domain/money";

export function PipelineValueCard({
  pipelineValuePaise,
  pipelineEnrollmentCount,
  error,
}: {
  pipelineValuePaise?: number;
  pipelineEnrollmentCount?: number;
  error?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Potential Pipeline Value</CardTitle>
        <CardDescription>
          Indicative fees associated with leads and applicants. Not confirmed revenue or
          outstanding debt.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error ? (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        ) : (
          <div className="flex items-baseline gap-3">
            <span className="text-2xl font-bold">
              {formatPaiseAsINR(pipelineValuePaise ?? 0)}
            </span>
            <span className="text-muted-foreground text-sm">
              across {pipelineEnrollmentCount ?? 0} lead/applicant record
              {pipelineEnrollmentCount === 1 ? "" : "s"}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
