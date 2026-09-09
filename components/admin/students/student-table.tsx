import Link from "next/link";
import { StudentStatusBadge } from "@/components/admin/students/student-status-badge";
import type { StudentListRow } from "@/lib/data/students";

export function StudentTable({ students }: { students: StudentListRow[] }) {
  if (students.length === 0) {
    return (
      <p className="text-muted-foreground py-8 text-center text-sm">No students found.</p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="py-2 pr-4 font-medium">Student ID</th>
            <th className="py-2 pr-4 font-medium">Name</th>
            <th className="py-2 pr-4 font-medium">Phone</th>
            <th className="py-2 pr-4 font-medium">Email</th>
            <th className="py-2 pr-4 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {students.map((student) => (
            <tr key={student.id} className="border-b last:border-0">
              <td className="py-2 pr-4 font-mono text-xs">{student.studentCode}</td>
              <td className="py-2 pr-4">
                <Link
                  href={`/admin/students/${student.id}`}
                  className="font-medium hover:underline"
                >
                  {student.firstName} {student.lastName}
                </Link>
              </td>
              <td className="py-2 pr-4">{student.phone}</td>
              <td className="py-2 pr-4">{student.email ?? "—"}</td>
              <td className="py-2 pr-4">
                <StudentStatusBadge status={student.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
