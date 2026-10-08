import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CertificateDownloadButton } from "@/components/certificates/certificate-download-button";
import { CertificateIssueForm } from "@/components/admin/certificates/certificate-issue-form";
import { CertificateRevokeForm } from "@/components/admin/certificates/certificate-revoke-form";
import { CertificateReissueForm } from "@/components/admin/certificates/certificate-reissue-form";
import {
  issueCertificateAction,
  revokeCertificateAction,
  reissueCertificateAction,
} from "@/lib/actions/certificates";
import {
  checkCertificateEligibility,
  getCertificatesForEnrollment,
} from "@/lib/data/certificates";

/**
 * Admin Certificates section for one Enrollment. Eligibility
 * (checkCertificateEligibility) re-derives all three checkpoint-approved
 * conditions — completed status, program.certificate_eligible, outstanding
 * balance via the existing FR-31 financial engine — every time this
 * renders; the Issue form only ever appears when eligible AND no
 * currently 'issued' row already exists for this Enrollment (issuing a
 * second concurrent certificate for the same completion event is not a
 * supported flow — Reissue, not a second Issue, is how a certificate gets
 * replaced).
 */
export async function CertificatesSection({ enrollmentId }: { enrollmentId: string }) {
  const [eligibilityResult, certificatesResult] = await Promise.all([
    checkCertificateEligibility(enrollmentId),
    getCertificatesForEnrollment(enrollmentId),
  ]);

  if (!certificatesResult.ok) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Certificates</CardTitle>
        </CardHeader>
        <CardContent>
          <p role="alert" className="text-destructive text-sm">
            {certificatesResult.error}
          </p>
        </CardContent>
      </Card>
    );
  }

  const certificates = certificatesResult.data;
  const eligibility = eligibilityResult.ok ? eligibilityResult.data : null;
  const canIssue = !!eligibility && eligibility.eligible && !eligibility.alreadyIssued;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Certificates</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {certificates.length === 0 ? (
          <p className="text-muted-foreground text-sm">No certificates issued yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {certificates.map((certificate) => (
              <li
                key={certificate.id}
                className="flex flex-col gap-2 border-t pt-3 text-sm"
              >
                <div className="flex items-center justify-between gap-3">
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
                  <CertificateDownloadButton certificateId={certificate.id} />
                </div>
                <p className="text-muted-foreground text-xs">
                  Issued {certificate.issueDate} · Completed {certificate.completionDate}
                  {certificate.status === "revoked" && certificate.revokedReason
                    ? ` · Revoked: ${certificate.revokedReason}`
                    : null}
                </p>
                {certificate.status === "issued" && (
                  <div className="flex gap-2">
                    <CertificateRevokeForm
                      action={revokeCertificateAction.bind(
                        null,
                        certificate.id,
                        enrollmentId,
                      )}
                    />
                    <CertificateReissueForm
                      action={reissueCertificateAction.bind(
                        null,
                        certificate.id,
                        enrollmentId,
                      )}
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {canIssue && (
          <CertificateIssueForm
            action={issueCertificateAction.bind(null, enrollmentId)}
          />
        )}

        {!canIssue &&
          eligibility &&
          !eligibility.alreadyIssued &&
          eligibility.reasons.length > 0 && (
            <p className="text-muted-foreground text-xs">
              {eligibility.reasons.join(" ")}
            </p>
          )}
      </CardContent>
    </Card>
  );
}
