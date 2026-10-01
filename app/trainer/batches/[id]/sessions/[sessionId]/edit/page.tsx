import { notFound } from "next/navigation";
import { TrainerClassSessionForm } from "@/components/trainer/trainer-class-session-form";
import { updateMyClassSessionAction } from "@/lib/actions/trainer-class-sessions";
import { getMySession } from "@/lib/data/trainer-portal";

export const dynamic = "force-dynamic";

export default async function EditTrainerClassSessionPage({
  params,
}: {
  params: Promise<{ id: string; sessionId: string }>;
}) {
  const { id, sessionId } = await params;
  const result = await getMySession(id, sessionId);

  if (!result.ok) {
    notFound();
  }

  const boundAction = updateMyClassSessionAction.bind(null, id, sessionId);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">
          Edit {result.data.topic ?? "Class Session"}
        </h1>
      </div>
      <TrainerClassSessionForm
        action={boundAction}
        defaultValues={result.data}
        submitLabel="Save changes"
      />
    </div>
  );
}
