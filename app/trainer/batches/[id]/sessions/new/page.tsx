import { notFound } from "next/navigation";
import { TrainerClassSessionForm } from "@/components/trainer/trainer-class-session-form";
import { createMyClassSessionAction } from "@/lib/actions/trainer-class-sessions";
import { getMyBatch } from "@/lib/data/trainer-portal";

export const dynamic = "force-dynamic";

// getMyBatch 404s identically for an unassigned batch and a nonexistent one
// (Phase 11 DoD) — verified here before rendering the form at all, same
// server-side ownership gate used by every other /trainer/batches/[id]/*
// route.
export default async function NewTrainerClassSessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const batchResult = await getMyBatch(id);
  if (!batchResult.ok) {
    notFound();
  }

  const boundAction = createMyClassSessionAction.bind(null, id);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Add Class Session</h1>
        <p className="text-muted-foreground text-sm">
          For {batchResult.data.name} ({batchResult.data.programName}).
        </p>
      </div>
      <TrainerClassSessionForm action={boundAction} submitLabel="Create session" />
    </div>
  );
}
