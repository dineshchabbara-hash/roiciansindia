import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AccessBadge } from "@/components/admin/accounts/access-badge";
import { ProvisionPortalAccessButton } from "@/components/admin/students/provision-portal-access-button";
import { ACTIVATION_INSTRUCTIONS, type PortalAccessState } from "@/lib/domain/accounts";

/**
 * Phase 21C — a student's portal login on the Admin student page
 * (DECISIONS_NEEDED D3: Admin provisions the login). Also shows the
 * student's own profile photo (FR-41) when they have uploaded one.
 */
export function PortalAccessCard({
  studentId,
  studentEmail,
  studentStatus,
  access,
  loadError,
  hasPhoto,
}: {
  studentId: string;
  studentEmail: string | null;
  studentStatus: string;
  access: PortalAccessState | null;
  loadError?: string;
  hasPhoto: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle asChild>
          <h2 className="text-base">Portal access</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-start">
        {hasPhoto && (
          // eslint-disable-next-line @next/next/no-img-element -- private, session-authorized route
          <img
            src={`/api/students/${studentId}/photo`}
            alt="Student profile photo"
            className="size-20 shrink-0 rounded-full border object-cover"
          />
        )}
        <div className="flex flex-col gap-3 text-sm">
          {loadError || !access ? (
            <p role="alert" className="text-destructive">
              {loadError ?? "Could not load portal access."}
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <AccessBadge access={access} />
                {access.status !== "none" && access.email && (
                  <span className="text-muted-foreground">Login: {access.email}</span>
                )}
              </div>
              {access.status === "none" ? (
                studentStatus !== "active" ? (
                  <p className="text-muted-foreground">
                    Portal access can only be given to an active student.
                  </p>
                ) : !studentEmail ? (
                  <p className="text-muted-foreground">
                    Add the student&apos;s email address first — it becomes their login.
                  </p>
                ) : (
                  <p className="text-muted-foreground">
                    Creates a Student login for {studentEmail}. {ACTIVATION_INSTRUCTIONS}
                  </p>
                )
              ) : access.status === "awaiting_activation" ? (
                <p className="text-muted-foreground">{ACTIVATION_INSTRUCTIONS}</p>
              ) : null}
              {/* Kept mounted in one place so its result message survives the
                  page refresh that follows a successful provisioning. */}
              <ProvisionPortalAccessButton
                studentId={studentId}
                showButton={
                  access.status === "none" &&
                  studentStatus === "active" &&
                  Boolean(studentEmail)
                }
              />
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
