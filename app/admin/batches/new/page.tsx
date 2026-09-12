import { BatchForm } from "@/components/admin/batches/batch-form";
import { createBatchAction } from "@/lib/actions/batches";
import { getProgramOptions } from "@/lib/data/batches";

export const dynamic = "force-dynamic";

export default async function NewBatchPage() {
  const programOptionsResult = await getProgramOptions();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Add Batch</h1>
        <p className="text-muted-foreground text-sm">
          Creates a new scheduled run of an existing program. New batches start in Draft
          status.
        </p>
      </div>
      {!programOptionsResult.ok ? (
        <p role="alert" className="text-destructive text-sm">
          {programOptionsResult.error}
        </p>
      ) : (
        <BatchForm
          action={createBatchAction}
          programOptions={programOptionsResult.data}
          submitLabel="Create batch"
        />
      )}
    </div>
  );
}
