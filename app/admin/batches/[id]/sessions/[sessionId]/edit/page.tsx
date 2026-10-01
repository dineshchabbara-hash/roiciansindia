import { notFound } from "next/navigation";
import { ClassSessionForm } from "@/components/admin/class-sessions/class-session-form";
import { updateClassSessionAction } from "@/lib/actions/class-sessions";
import { getClassSession } from "@/lib/data/class-sessions";

export const dynamic = "force-dynamic";

export default async function EditClassSessionPage({
  params,
}: {
  params: Promise<{ id: string; sessionId: string }>;
}) {
  const { id, sessionId } = await params;
  const result = await getClassSession(id, sessionId);

  if (!result.ok) {
    notFound();
  }

  const boundAction = updateClassSessionAction.bind(null, id, sessionId);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">
          Edit {result.data.topic ?? "Class Session"}
        </h1>
      </div>
      <ClassSessionForm
        action={boundAction}
        defaultValues={result.data}
        submitLabel="Save changes"
      />
    </div>
  );
}
