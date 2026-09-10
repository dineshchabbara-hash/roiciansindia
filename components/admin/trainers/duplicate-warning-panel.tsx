import { Label } from "@/components/ui/label";
import type { TrainerFormState } from "@/lib/actions/trainers";

/**
 * Trainer-scoped counterpart of components/admin/students/duplicate-warning-panel.tsx
 * (same markup/behavior, different state type) — kept as its own small
 * component rather than generalizing the student one, so Phase 5 Student
 * Management stays untouched.
 */
export function TrainerDuplicateWarningPanel({
  duplicates,
  defaultChecked,
  defaultReason,
}: {
  duplicates: NonNullable<TrainerFormState["duplicates"]>;
  defaultChecked?: boolean;
  defaultReason?: string;
}) {
  return (
    <div className="border-warning flex flex-col gap-3 rounded-md border bg-amber-50 p-4 dark:bg-amber-950/30">
      <p role="alert" className="text-sm font-medium">
        {duplicates.length === 1
          ? "A possible duplicate trainer was found:"
          : "Possible duplicate trainers were found:"}
      </p>
      <ul className="flex flex-col gap-2 text-sm">
        {duplicates.map((match) => (
          <li key={match.trainerId} className="border-b pb-2 last:border-0">
            <span className="font-medium">{match.name}</span>
            <div className="text-muted-foreground text-xs">
              {match.reasonLabels.join(" · ")}
            </div>
          </li>
        ))}
      </ul>

      <div className="flex items-start gap-2 pt-1">
        <input
          type="checkbox"
          id="confirmOverride"
          name="confirmOverride"
          className="mt-1"
          required
          defaultChecked={defaultChecked}
        />
        <Label htmlFor="confirmOverride" className="font-normal">
          I have reviewed the above and confirm this is a different person.
        </Label>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="overrideReason">Reason (required)</Label>
        <textarea
          id="overrideReason"
          name="overrideReason"
          required
          minLength={5}
          maxLength={500}
          rows={2}
          className="border-input rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs"
          placeholder="e.g. two trainers who happen to share a family phone number"
          defaultValue={defaultReason}
        />
      </div>
    </div>
  );
}
