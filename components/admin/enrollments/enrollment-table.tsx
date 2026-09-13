import Link from "next/link";
import { EnrollmentStatusBadge } from "@/components/admin/enrollments/enrollment-status-badge";
import { formatDecimalAsINR } from "@/lib/domain/money";
import type { EnrollmentListRow } from "@/lib/data/enrollments";

export function EnrollmentTable({ enrollments }: { enrollments: EnrollmentListRow[] }) {
  if (enrollments.length === 0) {
    return (
      <p className="text-muted-foreground py-8 text-center text-sm">
        No enrollments found.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="py-2 pr-4 font-medium">Enrollment code</th>
            <th className="py-2 pr-4 font-medium">Student</th>
            <th className="py-2 pr-4 font-medium">Program</th>
            <th className="py-2 pr-4 font-medium">Batch</th>
            <th className="py-2 pr-4 font-medium">Enrollment date</th>
            <th className="py-2 pr-4 font-medium">Status</th>
            <th className="py-2 pr-4 font-medium">Total payable</th>
          </tr>
        </thead>
        <tbody>
          {enrollments.map((enrollment) => (
            <tr key={enrollment.id} className="border-b last:border-0">
              <td className="py-2 pr-4">
                <Link
                  href={`/admin/enrollments/${enrollment.id}`}
                  className="font-medium hover:underline"
                >
                  {enrollment.enrollmentCode}
                </Link>
              </td>
              <td className="py-2 pr-4">
                {enrollment.studentName} ({enrollment.studentCode})
              </td>
              <td className="py-2 pr-4">{enrollment.programName}</td>
              <td className="py-2 pr-4">{enrollment.batchName ?? "—"}</td>
              <td className="py-2 pr-4">{enrollment.enrollmentDate}</td>
              <td className="py-2 pr-4">
                <EnrollmentStatusBadge status={enrollment.status} />
              </td>
              <td className="py-2 pr-4">{formatDecimalAsINR(enrollment.totalPayable)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
