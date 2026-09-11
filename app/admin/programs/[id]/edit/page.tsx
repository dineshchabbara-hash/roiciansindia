import { notFound } from "next/navigation";
import { ProgramForm } from "@/components/admin/programs/program-form";
import { updateProgramAction } from "@/lib/actions/programs";
import { getProgramProfile } from "@/lib/data/programs";

export const dynamic = "force-dynamic";

export default async function EditProgramPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const result = await getProgramProfile(id);

  if (!result.ok) {
    notFound();
  }

  const boundAction = updateProgramAction.bind(null, id);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Edit {result.data.name}</h1>
      </div>
      <ProgramForm
        action={boundAction}
        defaultValues={result.data}
        submitLabel="Save changes"
      />
    </div>
  );
}
