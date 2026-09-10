import { TrainerForm } from "@/components/admin/trainers/trainer-form";
import { createTrainerAction } from "@/lib/actions/trainers";

export const dynamic = "force-dynamic";

export default function NewTrainerPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Add Trainer</h1>
        <p className="text-muted-foreground text-sm">
          Creates a trainer profile and a login account. The trainer sets their own
          password via &quot;Forgot password&quot; on the Trainer login page.
        </p>
      </div>
      <TrainerForm action={createTrainerAction} submitLabel="Create trainer" />
    </div>
  );
}
