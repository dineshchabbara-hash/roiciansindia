import { Label } from "@/components/ui/label";
import type { StudentFormState } from "@/lib/actions/students";

/**
 * Rendered when the create-student action returns matched duplicates
 * instead of saving. Requires an explicit confirmation checkbox plus a
 * required reason before the form can be resubmitted with the override —
 * re-clicking "Save" alone is not enough (REQUIREMENTS.md FR-14).
 */
export function DuplicateWarningPanel({
  duplicates,
}: {
  duplicates: NonNullable<StudentFormState["duplicates"]>;
}) {
  return (
    <div className="border-warning flex flex-col gap-3 rounded-md border bg-amber-50 p-4 dark:bg-amber-950/30">
      <p role="alert" className="text-sm font-medium">
        {duplicates.length === 1
          ? "A possible duplicate student was found:"
          : "Possible duplicate students were found:"}
      </p>
      <ul className="flex flex-col gap-2 text-sm">
        {duplicates.map((match) => (
          <li key={match.studentId} className="border-b pb-2 last:border-0">
            <span className="font-medium">{match.name}</span>{" "}
            <span className="text-muted-foreground font-mono text-xs">
              ({match.studentCode})
            </span>
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
          placeholder="e.g. twin siblings, shared family phone number"
        />
      </div>
    </div>
  );
}
