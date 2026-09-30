import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUserContext } from "@/lib/auth/session";
import {
  getMyTrainerProfile,
  getMyBatches,
  getMyStudents,
  getMyPrograms,
} from "@/lib/data/trainer-portal";
import { TrainerBatchCard } from "@/components/trainer/trainer-batch-card";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const dynamic = "force-dynamic";

// Phase 11 scope (REQUIREMENTS.md FR-50): identity, assigned programs/
// batches, and assigned student count. Upcoming classes (Phase 12) and a
// pending-review queue (Phase 18) have no backing feature yet — shown here
// as inert, clearly-labeled cards, never as a clickable nav item to a page
// that doesn't exist yet (see the Phase 11 report).
export default async function TrainerHome() {
  const user = await getCurrentUserContext();
  if (!user) {
    redirect("/login/trainer");
  }

  const [profileResult, batchesResult, studentsResult, programsResult] =
    await Promise.all([
      getMyTrainerProfile(),
      getMyBatches(),
      getMyStudents(),
      getMyPrograms(),
    ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">
          Welcome{profileResult.ok ? `, ${profileResult.data.firstName}` : ""}
        </h1>
        {!profileResult.ok && (
          <p role="alert" className="text-destructive text-sm">
            {profileResult.error}
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Assigned batches</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {batchesResult.ok ? batchesResult.data.length : "—"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Assigned programs</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {programsResult.ok ? programsResult.data.length : "—"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Assigned students</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {studentsResult.ok ? studentsResult.data.length : "—"}
            </p>
          </CardContent>
        </Card>
      </div>

      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-medium">Your batches</h2>
          <Link href="/trainer/batches" className="text-primary text-sm hover:underline">
            View all
          </Link>
        </div>
        {batchesResult.ok ? (
          batchesResult.data.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              You don&apos;t have any assigned batches yet.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {batchesResult.data.slice(0, 4).map((batch) => (
                <TrainerBatchCard key={batch.id} batch={batch} />
              ))}
            </div>
          )
        ) : (
          <p role="alert" className="text-destructive text-sm">
            {batchesResult.error}
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Upcoming classes</CardTitle>
            <CardDescription>Coming in a later phase.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-sm">
              Class scheduling is not part of this phase yet — see{" "}
              <code className="bg-muted rounded px-1 py-0.5 font-mono text-xs">
                IMPLEMENTATION_PLAN.md
              </code>
              .
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Pending review</CardTitle>
            <CardDescription>Coming in a later phase.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-sm">
              Assignment review is not part of this phase yet — see{" "}
              <code className="bg-muted rounded px-1 py-0.5 font-mono text-xs">
                IMPLEMENTATION_PLAN.md
              </code>
              .
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
