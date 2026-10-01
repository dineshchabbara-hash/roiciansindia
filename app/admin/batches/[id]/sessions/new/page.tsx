import { notFound } from "next/navigation";
import { ClassSessionForm } from "@/components/admin/class-sessions/class-session-form";
import { createClassSessionAction } from "@/lib/actions/class-sessions";
import { getBatchProfile } from "@/lib/data/batches";

export const dynamic = "force-dynamic";

export default async function NewClassSessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const batchResult = await getBatchProfile(id);
  if (!batchResult.ok) {
    notFound();
  }

  const boundAction = createClassSessionAction.bind(null, id);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Add Class Session</h1>
        <p className="text-muted-foreground text-sm">
          For {batchResult.data.name} ({batchResult.data.programName}).
        </p>
      </div>
      <ClassSessionForm action={boundAction} submitLabel="Create session" />
    </div>
  );
}
