import Link from "next/link";
import { CreatePageForm } from "@/components/admin/website/create-page-form";
import { PageStatusBadge } from "@/components/admin/website/page-status-badge";
import type { WebsitePageSummary } from "@/lib/data/website";
import {
  ADMIN_PAGE_KINDS,
  PAGE_KIND_DESCRIPTIONS,
  PAGE_KIND_LABELS,
  formatWebsiteTimestamp,
  isPublicationHeld,
  pageDisplayName,
  type AdminPageKind,
} from "@/lib/domain/website-admin";

type Row =
  | { type: "page"; kind: AdminPageKind; page: WebsitePageSummary }
  | { type: "missing"; kind: AdminPageKind };

/** Every one-per-site page appears, created or not; legal pages are listed one by one. */
export function dashboardRows(pages: WebsitePageSummary[]): Row[] {
  const rows: Row[] = [];
  for (const kind of ADMIN_PAGE_KINDS) {
    const ofKind = pages.filter((p) => p.kind === kind);
    if (kind === "legal") {
      for (const page of [...ofKind].sort((a, b) => a.pageKey.localeCompare(b.pageKey))) {
        rows.push({ type: "page", kind, page });
      }
    } else if (ofKind[0]) {
      rows.push({ type: "page", kind, page: ofKind[0] });
    } else {
      rows.push({ type: "missing", kind });
    }
  }
  return rows;
}

function Person({ name, at }: { name: string | null; at: string | null }) {
  if (!at) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="flex flex-col">
      <span>{formatWebsiteTimestamp(at)}</span>
      <span className="text-muted-foreground text-xs">{name ?? "an admin"}</span>
    </span>
  );
}

/**
 * Phase 22B-1 Website pages dashboard: every supported page with its
 * publication status, last edit and last publication.
 */
export function WebsitePagesTable({ pages }: { pages: WebsitePageSummary[] }) {
  const rows = dashboardRows(pages);
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <caption className="sr-only">Website pages and their publication status</caption>
        <thead className="bg-muted/50 text-left">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">
              Page
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Status
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Last edited
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Published
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            if (row.type === "missing") {
              return (
                <tr key={row.kind} className="border-t align-top">
                  <th scope="row" className="px-3 py-3 text-left font-medium">
                    {PAGE_KIND_LABELS[row.kind]}
                    <p className="text-muted-foreground mt-0.5 max-w-md text-xs font-normal">
                      {PAGE_KIND_DESCRIPTIONS[row.kind]}
                    </p>
                  </th>
                  <td className="px-3 py-3">
                    <PageStatusBadge status="not_created" />
                  </td>
                  <td className="text-muted-foreground px-3 py-3">—</td>
                  <td className="text-muted-foreground px-3 py-3">—</td>
                  <td className="px-3 py-3">
                    <CreatePageForm kind={row.kind} />
                  </td>
                </tr>
              );
            }
            const { page } = row;
            const name = pageDisplayName(page);
            return (
              <tr key={page.id} className="border-t align-top">
                <th scope="row" className="px-3 py-3 text-left font-medium">
                  <Link
                    href={`/admin/website/pages/${page.id}`}
                    className="text-primary underline-offset-4 hover:underline"
                  >
                    {name}
                  </Link>
                  <p className="text-muted-foreground mt-0.5 max-w-md text-xs font-normal">
                    {page.title ?? "No content saved yet"}
                  </p>
                </th>
                <td className="px-3 py-3">
                  <div className="flex flex-col items-start gap-1">
                    <PageStatusBadge status={page.status} />
                    {isPublicationHeld(page) && (
                      <span className="text-xs text-amber-700 dark:text-amber-400">
                        Publishing held: wording not yet approved
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-3">
                  <Person name={page.updatedByName} at={page.updatedAt} />
                </td>
                <td className="px-3 py-3">
                  <Person name={page.publishedByName} at={page.publishedAt} />
                </td>
                <td className="px-3 py-3">
                  <Link
                    href={`/admin/website/pages/${page.id}`}
                    className="text-primary text-sm underline-offset-4 hover:underline"
                    aria-label={`Edit ${name}`}
                  >
                    Edit
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
