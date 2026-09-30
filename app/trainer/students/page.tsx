import { getMyStudents } from "@/lib/data/trainer-portal";
import { TrainerStudentTable } from "@/components/trainer/trainer-student-table";

export const dynamic = "force-dynamic";

// Assigned Students (REQUIREMENTS.md FR-51, IMPLEMENTATION_PLAN.md Phase
// 11): getMyStudents (lib/data/trainer-portal.ts) reads exclusively from
// the trainer_visible_students() database function, already scoped to the
// caller's own assigned batches — there is no id here to manipulate.
export default async function TrainerStudentsPage() {
  const result = await getMyStudents();

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">My Students</h1>

      {!result.ok && (
        <p role="alert" className="text-destructive text-sm">
          {result.error}
        </p>
      )}

      {result.ok && <TrainerStudentTable students={result.data} />}
    </div>
  );
}
