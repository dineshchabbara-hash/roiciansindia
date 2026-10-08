import { type NextRequest } from "next/server";
import { getCurrentUserContext } from "@/lib/auth/session";
import { isAdminOrSuperAdmin } from "@/lib/domain/rbac";
import { fetchReportRange } from "@/lib/data/reports";
import { CSV_UTF8_BOM, toCsvRecord } from "@/lib/domain/csv";
import {
  REPORT_EXPORT_BATCH_SIZE,
  REPORT_EXPORT_MAX_ROWS,
  isReportKind,
  parseReportFilters,
  reportExportFileName,
  reportHeaders,
  reportRowCells,
  type RawSearchParams,
  type ReportKind,
} from "@/lib/domain/reports";

/**
 * GET /api/exports/[report] — Phase 19 CSV export (API_AND_INTEGRATIONS.md
 * §7). Admin/Super Admin only, authorized here independently of the
 * /admin layout (a Route Handler never passes through it).
 *
 * The CSV is built from exactly the same filter parser, query and
 * row-to-cell mapping as the on-screen report (lib/domain/reports.ts,
 * lib/data/reports.ts), iterated server-side in bounded batches and
 * streamed — the full result set is never held in the browser.
 *
 * No silent truncation:
 *  - an export whose row count exceeds REPORT_EXPORT_MAX_ROWS is refused
 *    with 413 before any CSV is produced;
 *  - if a later batch fails, or the matching row count changes while the
 *    export is running, the stream is errored (the download fails visibly)
 *    rather than ending as a short but well-formed file.
 *
 * Read-only: no row is written anywhere, including audit_logs (no project
 * document calls for auditing exports).
 */

export const dynamic = "force-dynamic";

function textResponse(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function toRawSearchParams(searchParams: URLSearchParams): RawSearchParams {
  const raw: Record<string, string[]> = {};
  for (const [key, value] of searchParams) {
    (raw[key] ??= []).push(value);
  }
  return raw;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ report: string }> },
): Promise<Response> {
  // Authorization first — before even revealing which report names exist.
  const user = await getCurrentUserContext();
  if (!user) return textResponse(401, "Sign in to export reports.");
  if (!isAdminOrSuperAdmin(user.role)) {
    return textResponse(403, "You do not have permission to export reports.");
  }

  const { report } = await params;
  if (!isReportKind(report)) return textResponse(404, "Unknown report.");
  const kind: ReportKind = report;

  const filters = parseReportFilters(
    kind,
    toRawSearchParams(request.nextUrl.searchParams),
  );

  const firstBatch = await fetchReportRange(
    kind,
    filters,
    0,
    REPORT_EXPORT_BATCH_SIZE - 1,
  );
  if (!firstBatch.ok) return textResponse(500, firstBatch.error);

  const total = firstBatch.data.total;
  if (total > REPORT_EXPORT_MAX_ROWS) {
    return textResponse(
      413,
      `This export would contain ${total} rows, above the ${REPORT_EXPORT_MAX_ROWS}-row limit. Narrow the filters and export again.`,
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let written = 0;
      const writeRows = (rows: ReadonlyArray<unknown>) => {
        let chunk = "";
        for (const row of rows) {
          chunk += toCsvRecord(reportRowCells(kind, row as never));
        }
        written += rows.length;
        if (chunk) controller.enqueue(encoder.encode(chunk));
      };

      controller.enqueue(encoder.encode(CSV_UTF8_BOM + toCsvRecord(reportHeaders(kind))));
      writeRows(firstBatch.data.rows);

      for (
        let from = REPORT_EXPORT_BATCH_SIZE;
        from < total;
        from += REPORT_EXPORT_BATCH_SIZE
      ) {
        const batch = await fetchReportRange(
          kind,
          filters,
          from,
          from + REPORT_EXPORT_BATCH_SIZE - 1,
        );
        if (!batch.ok) {
          controller.error(new Error(batch.error));
          return;
        }
        if (batch.data.total !== total) {
          controller.error(
            new Error("The report changed while it was being exported. Export again."),
          );
          return;
        }
        writeRows(batch.data.rows);
      }

      if (written !== total) {
        controller.error(
          new Error("The report changed while it was being exported. Export again."),
        );
        return;
      }
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${reportExportFileName(kind, new Date())}"`,
      "Cache-Control": "no-store, private",
      "X-Content-Type-Options": "nosniff",
      "X-Report-Row-Count": String(total),
    },
  });
}
