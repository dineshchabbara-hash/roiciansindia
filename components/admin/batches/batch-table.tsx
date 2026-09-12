import Link from "next/link";
import { BatchStatusBadge } from "@/components/admin/batches/batch-status-badge";
import type { BatchListRow } from "@/lib/data/batches";

export function BatchTable({ batches }: { batches: BatchListRow[] }) {
  if (batches.length === 0) {
    return (
      <p className="text-muted-foreground py-8 text-center text-sm">No batches found.</p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="py-2 pr-4 font-medium">Name</th>
            <th className="py-2 pr-4 font-medium">Program</th>
            <th className="py-2 pr-4 font-medium">Start date</th>
            <th className="py-2 pr-4 font-medium">End date</th>
            <th className="py-2 pr-4 font-medium">Capacity</th>
            <th className="py-2 pr-4 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {batches.map((batch) => (
            <tr key={batch.id} className="border-b last:border-0">
              <td className="py-2 pr-4">
                <Link
                  href={`/admin/batches/${batch.id}`}
                  className="font-medium hover:underline"
                >
                  {batch.name}
                </Link>
              </td>
              <td className="py-2 pr-4">{batch.programName}</td>
              <td className="py-2 pr-4">{batch.startDate}</td>
              <td className="py-2 pr-4">{batch.expectedEndDate ?? "—"}</td>
              <td className="py-2 pr-4">{batch.capacity ?? "—"}</td>
              <td className="py-2 pr-4">
                <BatchStatusBadge status={batch.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
