import { getMyEnrollments } from "@/lib/data/student-portal";
import { StudentEnrollmentCard } from "@/components/student/student-enrollment-card";

export const dynamic = "force-dynamic";

// Programs view (IMPLEMENTATION_PLAN.md Phase 10): read-only, scoped to the
// signed-in Student's own enrollments only — getMyEnrollments()
// (lib/data/student-portal.ts) resolves "own" from the caller's session,
// never from anything in this route, so there is no id here to manipulate.
export default async function StudentEnrollmentsPage() {
  const result = await getMyEnrollments();

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">My Enrollments</h1>

      {!result.ok && (
        <p role="alert" className="text-destructive text-sm">
          {result.error}
        </p>
      )}

      {result.ok &&
        (result.data.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            You don&apos;t have any enrollments yet.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {result.data.map((enrollment) => (
              <StudentEnrollmentCard key={enrollment.id} enrollment={enrollment} />
            ))}
          </div>
        ))}
    </div>
  );
}
