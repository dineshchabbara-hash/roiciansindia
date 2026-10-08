import { Button } from "@/components/ui/button";
import { REPORT_EXPORT_MAX_ROWS } from "@/lib/domain/reports";

/**
 * Visible row count for the current filters plus the CSV export control.
 * The export is a plain link to the server route (which re-checks
 * authorization and the row cap itself); above the cap it is replaced by
 * an explanation rather than offering a download that would be refused.
 */
export function ReportResultSummary({
  total,
  page,
  pageSize,
  rowsOnPage,
  exportHref,
}: {
  total: number;
  page: number;
  pageSize: number;
  rowsOnPage: number;
  exportHref: string;
}) {
  const first = rowsOnPage === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = rowsOnPage === 0 ? 0 : first + rowsOnPage - 1;
  const rowWord = total === 1 ? "row" : "rows";
  const overCap = total > REPORT_EXPORT_MAX_ROWS;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm" aria-live="polite">
        {total === 0
          ? "0 rows match these filters."
          : `Showing ${first}–${last} of ${total} ${rowWord}.`}
      </p>
      {overCap ? (
        <p className="text-muted-foreground text-sm">
          Export is limited to {REPORT_EXPORT_MAX_ROWS} rows. Narrow the filters to
          export.
        </p>
      ) : (
        <Button variant="outline" size="sm" asChild>
          <a href={exportHref} download>
            Export CSV
          </a>
        </Button>
      )}
    </div>
  );
}
