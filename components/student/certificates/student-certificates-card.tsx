import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CertificateDownloadButton } from "@/components/certificates/certificate-download-button";
import type { CertificateRow } from "@/lib/data/certificates";

/**
 * Student's own certificates for this Enrollment. Shown regardless of the
 * Enrollment's current status — an issued certificate is a permanent
 * academic record, not something that should disappear if the Enrollment
 * later changes state (REQUIREMENTS §28; no Materials/Assignments-style
 * status filtering applies here). Revoked rows stay visible too — history
 * is never hidden, only clearly labeled.
 */
export function StudentCertificatesCard({
  certificates,
}: {
  certificates: CertificateRow[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Certificates</CardTitle>
      </CardHeader>
      <CardContent>
        {certificates.length === 0 ? (
          <p className="text-muted-foreground text-sm">No certificates issued yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {certificates.map((certificate) => (
              <li
                key={certificate.id}
                className="flex items-center justify-between gap-3 border-t pt-3 text-sm first:border-0 first:pt-0"
              >
                <div className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{certificate.certificateNumber}</span>
                    <Badge
                      variant={
                        certificate.status === "issued" ? "success" : "destructive"
                      }
                    >
                      {certificate.status === "issued" ? "Valid" : "Revoked"}
                    </Badge>
                  </div>
                  <span className="text-muted-foreground text-xs">
                    Issued {certificate.issueDate}
                  </span>
                </div>
                <CertificateDownloadButton certificateId={certificate.id} />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
