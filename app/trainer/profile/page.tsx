import { getMyTrainerProfile } from "@/lib/data/trainer-portal";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

// Read-only (Phase 11 report): no REQUIREMENTS.md FR authorizes any Trainer
// self-edit, and there is no trainers_update_own RLS policy at all — only
// Admin/Super Admin may change a trainer row. Unlike the Student Portal
// (FR-41), this page has no form at all.
export default async function TrainerProfilePage() {
  const result = await getMyTrainerProfile();

  if (!result.ok) {
    return (
      <p role="alert" className="text-destructive text-sm">
        {result.error}
      </p>
    );
  }

  const profile = result.data;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">My Profile</h1>

      <Card>
        <CardHeader>
          <CardTitle>Identity</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-3">
          <div>
            <p className="text-muted-foreground text-xs">Name</p>
            <p>
              {profile.firstName} {profile.lastName}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Email</p>
            <p>{profile.email}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Phone</p>
            <p>{profile.phone ?? "—"}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Status</p>
            <p className="capitalize">{profile.status}</p>
          </div>
          <div className="col-span-2 md:col-span-3">
            <p className="text-muted-foreground text-xs">Specialization</p>
            <p>
              {profile.specialization.length > 0
                ? profile.specialization.join(", ")
                : "—"}
            </p>
          </div>
          <div className="col-span-2 md:col-span-3">
            <p className="text-muted-foreground text-xs">Bio</p>
            <p className="whitespace-pre-wrap">{profile.bio ?? "—"}</p>
          </div>
        </CardContent>
        <CardContent className="text-muted-foreground pt-0 text-xs">
          Profile details can only be changed by an administrator.
        </CardContent>
      </Card>
    </div>
  );
}
