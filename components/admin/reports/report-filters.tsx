import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  FINANCIAL_GROUPS,
  FINANCIAL_GROUP_LABELS,
  REPORT_DEFINITIONS,
  humanizeStatus,
  type ReportFilters,
  type ReportKind,
} from "@/lib/domain/reports";

const SELECT_CLASS =
  "border-input h-9 rounded-md border bg-transparent px-3 text-sm shadow-xs";

/**
 * Plain GET form (no client JS), same pattern as the Admin Students list:
 * filter state lives in the URL and every filter is applied server-side by
 * lib/data/reports.ts. Only the filters this report supports are rendered,
 * and the export link is built from the same parsed values.
 */
export function ReportFiltersForm({
  kind,
  filters,
  programs,
  batches,
}: {
  kind: ReportKind;
  filters: ReportFilters;
  programs: Array<{ id: string; name: string }>;
  batches: Array<{ id: string; name: string }>;
}) {
  const def = REPORT_DEFINITIONS[kind];
  const basePath = `/admin/reports/${kind}`;

  return (
    <form
      method="GET"
      action={basePath}
      aria-label={`${def.title} filters`}
      className="flex flex-wrap items-end gap-3"
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="report-q">Search</Label>
        <Input
          id="report-q"
          name="q"
          defaultValue={filters.q}
          placeholder={def.searchPlaceholder}
          className="w-64"
        />
      </div>

      {def.statuses && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="report-status">Status</Label>
          <select
            id="report-status"
            name="status"
            defaultValue={filters.status ?? ""}
            className={SELECT_CLASS}
          >
            <option value="">All statuses</option>
            {def.statuses.map((status) => (
              <option key={status} value={status}>
                {humanizeStatus(status)}
              </option>
            ))}
          </select>
        </div>
      )}

      {def.supportsGroup && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="report-group">Enrollment group</Label>
          <select
            id="report-group"
            name="group"
            defaultValue={filters.group}
            className={SELECT_CLASS}
          >
            {FINANCIAL_GROUPS.map((group) => (
              <option key={group} value={group}>
                {FINANCIAL_GROUP_LABELS[group]}
              </option>
            ))}
          </select>
        </div>
      )}

      {def.supportsProgram && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="report-program">Program</Label>
          <select
            id="report-program"
            name="programId"
            defaultValue={filters.programId ?? ""}
            className={SELECT_CLASS}
          >
            <option value="">All programs</option>
            {programs.map((program) => (
              <option key={program.id} value={program.id}>
                {program.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {def.supportsBatch && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="report-batch">Batch</Label>
          <select
            id="report-batch"
            name="batchId"
            defaultValue={filters.batchId ?? ""}
            className={SELECT_CLASS}
          >
            <option value="">All batches</option>
            {batches.map((batch) => (
              <option key={batch.id} value={batch.id}>
                {batch.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {def.dateLabel && (
        <>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="report-from">{def.dateLabel} from</Label>
            <Input
              id="report-from"
              name="from"
              type="date"
              defaultValue={filters.from ?? ""}
              className="w-40"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="report-to">{def.dateLabel} to</Label>
            <Input
              id="report-to"
              name="to"
              type="date"
              defaultValue={filters.to ?? ""}
              className="w-40"
            />
          </div>
        </>
      )}

      {def.supportsBelow && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="report-below">Attendance below (%)</Label>
          <Input
            id="report-below"
            name="below"
            type="number"
            min={1}
            max={100}
            step={1}
            defaultValue={filters.below ?? ""}
            className="w-28"
          />
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="report-sort">Sort by</Label>
        <select
          id="report-sort"
          name="sort"
          defaultValue={filters.sort}
          className={SELECT_CLASS}
        >
          {Object.entries(def.sorts).map(([key, option]) => (
            <option key={key} value={key}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="report-dir">Order</Label>
        <select
          id="report-dir"
          name="dir"
          defaultValue={filters.dir}
          className={SELECT_CLASS}
        >
          <option value="asc">Ascending</option>
          <option value="desc">Descending</option>
        </select>
      </div>

      <Button type="submit" variant="secondary">
        Apply filters
      </Button>
      <Button variant="ghost" asChild>
        <Link href={basePath}>Reset</Link>
      </Button>
    </form>
  );
}
