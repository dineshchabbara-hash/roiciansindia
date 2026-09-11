import Link from "next/link";
import { ProgramStatusBadge } from "@/components/admin/programs/program-status-badge";
import { formatPaiseAsINR, toPaise } from "@/lib/domain/money";
import type { ProgramListRow } from "@/lib/data/programs";

function formatDuration(row: ProgramListRow): string {
  if (row.durationValue === null || row.durationUnit === null) return "—";
  return `${row.durationValue} ${row.durationUnit}`;
}

export function ProgramTable({ programs }: { programs: ProgramListRow[] }) {
  if (programs.length === 0) {
    return (
      <p className="text-muted-foreground py-8 text-center text-sm">No programs found.</p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="py-2 pr-4 font-medium">Code</th>
            <th className="py-2 pr-4 font-medium">Name</th>
            <th className="py-2 pr-4 font-medium">Duration</th>
            <th className="py-2 pr-4 font-medium">Regular fee</th>
            <th className="py-2 pr-4 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {programs.map((program) => (
            <tr key={program.id} className="border-b last:border-0">
              <td className="py-2 pr-4 font-mono text-xs">{program.programCode}</td>
              <td className="py-2 pr-4">
                <Link
                  href={`/admin/programs/${program.id}`}
                  className="font-medium hover:underline"
                >
                  {program.name}
                </Link>
              </td>
              <td className="py-2 pr-4">{formatDuration(program)}</td>
              <td className="py-2 pr-4">
                {formatPaiseAsINR(toPaise(program.regularFee))}
              </td>
              <td className="py-2 pr-4">
                <ProgramStatusBadge status={program.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
