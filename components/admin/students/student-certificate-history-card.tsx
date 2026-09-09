import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { StudentCertificateHistoryRow } from "@/lib/data/students";

export function StudentCertificateHistoryCard({
  data,
  error,
}: {
  data?: StudentCertificateHistoryRow[];
  error?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Certificates</CardTitle>
      </CardHeader>
      <CardContent>
        {error ? (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        ) : !data || data.length === 0 ? (
          <p className="text-muted-foreground text-sm">No certificates issued yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {data.map((certificate) => (
              <li
                key={certificate.id}
                className="flex items-center justify-between gap-3 border-b pb-3 last:border-0 last:pb-0"
              >
                <div>
                  <p className="text-sm font-medium">{certificate.programName}</p>
                  <p className="text-muted-foreground font-mono text-xs">
                    {certificate.certificateNumber}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Badge
                    variant={certificate.status === "issued" ? "success" : "destructive"}
                  >
                    {certificate.status}
                  </Badge>
                  <span className="text-muted-foreground text-xs">
                    {certificate.issueDate}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
