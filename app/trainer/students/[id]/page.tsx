import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getMyStudent } from "@/lib/data/trainer-portal";

export const dynamic = "force-dynamic";

// Direct-URL/ID-manipulation defense point (IMPLEMENTATION_PLAN.md Phase 11
// DoD): getMyStudent (lib/data/trainer-portal.ts) filters the same trainer-
// scoped trainer_visible_students() result set by this id — a Student
// outside the caller's own assigned batches therefore comes back
// identically to a genuinely nonexistent one — notFound() either way.
export default async function TrainerStudentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const result = await getMyStudent(id);

  if (!result.ok) {
    if (result.error === "Student not found.") {
      notFound();
    }
    return (
      <p role="alert" className="text-destructive text-sm">
        {result.error}
      </p>
    );
  }

  const student = result.data;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">
        {student.firstName} {student.lastName}
      </h1>
      <p className="text-muted-foreground text-sm">{student.studentCode}</p>

      <Card>
        <CardHeader>
          <CardTitle>Contact</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-3">
          <div>
            <p className="text-muted-foreground text-xs">Phone</p>
            <p>{student.phone}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Email</p>
            <p>{student.email ?? "—"}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
