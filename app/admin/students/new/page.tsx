import { StudentForm } from "@/components/admin/students/student-form";
import { createStudentAction } from "@/lib/actions/students";

export const dynamic = "force-dynamic";

export default function NewStudentPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Add Student</h1>
        <p className="text-muted-foreground text-sm">
          The Student ID is assigned automatically and cannot be changed later.
        </p>
      </div>
      <StudentForm action={createStudentAction} submitLabel="Create student" />
    </div>
  );
}
