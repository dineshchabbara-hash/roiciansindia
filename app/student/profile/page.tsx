import { getMyStudentProfile } from "@/lib/data/student-portal";
import { updateMyProfileAction } from "@/lib/actions/student-profile";
import { StudentProfileForm } from "@/components/student/student-profile-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProfilePhotoCard } from "@/components/student/profile-photo-card";
import {
  MAX_PROFILE_PHOTO_LABEL,
  getProfilePhotoVersion,
} from "@/lib/data/profile-photos";

export const dynamic = "force-dynamic";

// Read-only identity fields + a self-edit form limited to exactly
// REQUIREMENTS.md FR-41's Student self-service set (phone, address) — see
// lib/validation/student-self-profile.ts and the Phase 10 report for why
// name/DOB/gender/email/status are shown read-only here rather than as
// editable fields, and why profile photo/password are not yet part of this
// form. (Phase 21C: the profile photo is now a separate card below — FR-41.)
export default async function StudentProfilePage() {
  const result = await getMyStudentProfile();

  if (!result.ok) {
    return (
      <p role="alert" className="text-destructive text-sm">
        {result.error}
      </p>
    );
  }

  const profile = result.data;
  const photoVersion = await getProfilePhotoVersion(profile.id);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">My Profile</h1>

      <Card>
        <CardHeader>
          <CardTitle>Identity</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-3">
          <div>
            <p className="text-muted-foreground text-xs">Student ID</p>
            <p>{profile.studentCode}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Name</p>
            <p>
              {profile.firstName} {profile.lastName}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Email</p>
            <p>{profile.email ?? "—"}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Registration date</p>
            <p>{profile.registrationDate}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Status</p>
            <p className="capitalize">{profile.status}</p>
          </div>
        </CardContent>
        <CardContent className="text-muted-foreground pt-0 text-xs">
          Name, email, and status can only be changed by an administrator.
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Profile photo</CardTitle>
        </CardHeader>
        <CardContent>
          <ProfilePhotoCard
            studentId={profile.id}
            hasPhoto={photoVersion !== null}
            version={photoVersion ?? "none"}
            maxLabel={MAX_PROFILE_PHOTO_LABEL}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Contact &amp; address</CardTitle>
        </CardHeader>
        <CardContent>
          <StudentProfileForm action={updateMyProfileAction} profile={profile} />
        </CardContent>
      </Card>
    </div>
  );
}
