import { formatDecimalAsINR } from "@/lib/domain/money";
import {
  REPORT_COLUMNS,
  REPORT_DEFINITIONS,
  reportRowCells,
  type ReportKind,
  type ReportRowByKind,
} from "@/lib/domain/reports";

function rowKey(kind: ReportKind, row: ReportRowByKind[ReportKind]): string {
  if (kind === "attendance") {
    const r = row as ReportRowByKind["attendance"];
    return `${r.enrollmentId}:${r.batchId}`;
  }
  return (row as { id: string }).id;
}

/**
 * Renders exactly the cells the CSV export writes (reportRowCells) — the
 * only presentation difference is that money cells get an INR prefix and
 * digit grouping here (formatDecimalAsINR keeps the exact paise; the CSV
 * keeps the plain decimal for spreadsheets).
 */
export function ReportTable<K extends ReportKind>({
  kind,
  rows,
}: {
  kind: K;
  rows: ReadonlyArray<ReportRowByKind[K]>;
}) {
  const columns = REPORT_COLUMNS[kind];

  if (rows.length === 0) {
    return (
      <p className="text-muted-foreground py-8 text-center text-sm">
        No rows match these filters.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">{REPORT_DEFINITIONS[kind].title}</caption>
        <thead>
          <tr className="border-b text-left">
            {columns.map((column) => (
              <th
                key={column.header}
                scope="col"
                className={`py-2 pr-4 font-medium whitespace-nowrap ${
                  column.kind === "text" ? "" : "text-right"
                }`}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const cells = reportRowCells(kind, row);
            return (
              <tr key={rowKey(kind, row)} className="border-b last:border-0">
                {cells.map((cell, index) => {
                  const column = columns[index];
                  const text =
                    column.kind === "money"
                      ? formatDecimalAsINR(String(cell))
                      : column.kind === "percent" && cell !== ""
                        ? `${cell}%`
                        : cell === "" || cell === null || cell === undefined
                          ? "—"
                          : String(cell);
                  return (
                    <td
                      key={column.header}
                      className={`py-2 pr-4 ${
                        column.kind === "text" ? "" : "text-right tabular-nums"
                      }`}
                    >
                      {text}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
