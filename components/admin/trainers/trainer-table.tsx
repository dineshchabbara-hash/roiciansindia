import Link from "next/link";
import { TrainerStatusBadge } from "@/components/admin/trainers/trainer-status-badge";
import type { TrainerListRow } from "@/lib/data/trainers";

export function TrainerTable({ trainers }: { trainers: TrainerListRow[] }) {
  if (trainers.length === 0) {
    return (
      <p className="text-muted-foreground py-8 text-center text-sm">No trainers found.</p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="py-2 pr-4 font-medium">Name</th>
            <th className="py-2 pr-4 font-medium">Email</th>
            <th className="py-2 pr-4 font-medium">Phone</th>
            <th className="py-2 pr-4 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {trainers.map((trainer) => (
            <tr key={trainer.id} className="border-b last:border-0">
              <td className="py-2 pr-4">
                <Link
                  href={`/admin/trainers/${trainer.id}`}
                  className="font-medium hover:underline"
                >
                  {trainer.firstName} {trainer.lastName}
                </Link>
              </td>
              <td className="py-2 pr-4">{trainer.email}</td>
              <td className="py-2 pr-4">{trainer.phone ?? "—"}</td>
              <td className="py-2 pr-4">
                <TrainerStatusBadge status={trainer.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
