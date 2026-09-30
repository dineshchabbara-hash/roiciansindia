import { getMyBatches } from "@/lib/data/trainer-portal";
import { TrainerBatchCard } from "@/components/trainer/trainer-batch-card";

export const dynamic = "force-dynamic";

// Assigned Batches (REQUIREMENTS.md FR-51, IMPLEMENTATION_PLAN.md Phase 11):
// getMyBatches (lib/data/trainer-portal.ts) resolves "assigned" from the
// caller's own session, never from anything in this route, so there is no
// id here to manipulate.
export default async function TrainerBatchesPage() {
  const result = await getMyBatches();

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">My Batches</h1>

      {!result.ok && (
        <p role="alert" className="text-destructive text-sm">
          {result.error}
        </p>
      )}

      {result.ok &&
        (result.data.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            You don&apos;t have any assigned batches yet.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {result.data.map((batch) => (
              <TrainerBatchCard key={batch.id} batch={batch} />
            ))}
          </div>
        ))}
    </div>
  );
}
