import Link from "next/link";
import type { MyStudentRow } from "@/lib/data/trainer-portal";

/**
 * Trainer-facing student directory — basic info only (FR-51/FR-54): name,
 * Student ID, phone, email. Never address/DOB/emergency-contact/financial
 * columns — lib/data/trainer-portal.ts sources this exclusively from the
 * trainer_visible_students() database function, which already excludes them.
 */
export function TrainerStudentTable({ students }: { students: MyStudentRow[] }) {
  if (students.length === 0) {
    return (
      <p className="text-muted-foreground py-8 text-center text-sm">
        No students found in your assigned batches.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="py-2 pr-4 font-medium">Student</th>
            <th className="py-2 pr-4 font-medium">Student ID</th>
            <th className="py-2 pr-4 font-medium">Phone</th>
            <th className="py-2 pr-4 font-medium">Email</th>
          </tr>
        </thead>
        <tbody>
          {students.map((student) => (
            <tr key={student.studentId} className="border-b last:border-0">
              <td className="py-2 pr-4">
                <Link
                  href={`/trainer/students/${student.studentId}`}
                  className="font-medium hover:underline"
                >
                  {student.firstName} {student.lastName}
                </Link>
              </td>
              <td className="py-2 pr-4">{student.studentCode}</td>
              <td className="py-2 pr-4">{student.phone}</td>
              <td className="py-2 pr-4">{student.email ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
