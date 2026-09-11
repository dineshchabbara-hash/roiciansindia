import { ProgramForm } from "@/components/admin/programs/program-form";
import { createProgramAction } from "@/lib/actions/programs";

export const dynamic = "force-dynamic";

export default function NewProgramPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Add Program</h1>
        <p className="text-muted-foreground text-sm">
          Creates a new entry in the course/program catalog. New programs start in Draft
          status.
        </p>
      </div>
      <ProgramForm action={createProgramAction} submitLabel="Create program" />
    </div>
  );
}
