import { notFound } from "next/navigation";
import { BatchForm } from "@/components/admin/batches/batch-form";
import { updateBatchAction } from "@/lib/actions/batches";
import { getBatchProfile, getProgramOptions } from "@/lib/data/batches";

export const dynamic = "force-dynamic";

export default async function EditBatchPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [result, programOptionsResult] = await Promise.all([
    getBatchProfile(id),
    getProgramOptions(),
  ]);

  if (!result.ok) {
    notFound();
  }

  const boundAction = updateBatchAction.bind(null, id);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Edit {result.data.name}</h1>
      </div>
      <BatchForm
        action={boundAction}
        defaultValues={result.data}
        programOptions={programOptionsResult.ok ? programOptionsResult.data : []}
        submitLabel="Save changes"
      />
    </div>
  );
}
