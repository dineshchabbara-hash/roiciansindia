import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { PageStatusBadge } from "@/components/admin/website/page-status-badge";
import { SetUpProgramForm } from "@/components/admin/website/programs/set-up-program-form";
import type { ProgramWebsiteSummary } from "@/lib/data/website-programs";
import { suggestSlug } from "@/lib/domain/website";
import {
  LMS_PROGRAM_STATUS_LABELS,
  programCanGetWebsiteContent,
} from "@/lib/domain/website-programs";

/**
 * Phase 22B-2 Programs list: every LMS Program with its website entry. A
 * Program has no public content until an Admin writes and publishes it.
 */
export function ProgramWebsiteList({ entries }: { entries: ProgramWebsiteSummary[] }) {
  if (entries.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        There are no Programs in the LMS yet. Programs are created under Programs in the
        Admin portal.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <caption className="sr-only">Programs and their website content</caption>
        <thead className="bg-muted/50 text-left">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">
              Program (LMS)
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Website content
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Web address
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Placement
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map(({ program, document }) => (
            <tr key={program.id} className="border-t align-top">
              <th scope="row" className="px-3 py-3 text-left font-medium">
                {program.name}
                <p className="text-muted-foreground mt-0.5 text-xs font-normal">
                  {program.code} · {LMS_PROGRAM_STATUS_LABELS[program.status]}
                </p>
              </th>
              {document ? (
                <>
                  <td className="px-3 py-3">
                    <div className="flex flex-col items-start gap-1">
                      <PageStatusBadge status={document.status} />
                      <span className="text-muted-foreground max-w-xs text-xs">
                        {document.title ?? "No content saved yet"}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <code className="text-xs">/programs/{document.slug}</code>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex flex-col items-start gap-1 text-xs">
                      <span>{document.placement.displayGroupName ?? "No group"}</span>
                      {document.placement.isFeatured && (
                        <Badge variant="secondary">
                          Featured
                          {document.placement.featuredOrder !== null
                            ? ` #${document.placement.featuredOrder}`
                            : ""}
                        </Badge>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex flex-col items-start gap-1">
                      <Link
                        href={`/admin/website/programs/${document.id}`}
                        className="text-primary text-sm underline-offset-4 hover:underline"
                        aria-label={`Edit website content for ${program.name}`}
                      >
                        Edit content
                      </Link>
                      <Link
                        href={`/admin/website/programs/${document.id}/settings`}
                        className="text-primary text-sm underline-offset-4 hover:underline"
                        aria-label={`Web address and placement for ${program.name}`}
                      >
                        Placement
                      </Link>
                      <Link
                        href={`/admin/website/programs/${document.id}/batches`}
                        className="text-primary text-sm underline-offset-4 hover:underline"
                        aria-label={`Batches on the website for ${program.name}`}
                      >
                        Batches
                      </Link>
                    </div>
                  </td>
                </>
              ) : (
                <>
                  <td className="px-3 py-3">
                    <PageStatusBadge status="not_created" />
                  </td>
                  <td className="text-muted-foreground px-3 py-3" colSpan={3}>
                    {programCanGetWebsiteContent(program.status) ? (
                      <SetUpProgramForm
                        programId={program.id}
                        programName={program.name}
                        suggestedSlug={suggestSlug(program.name)}
                      />
                    ) : (
                      <span className="text-xs">
                        Archived Programs cannot get website content.
                      </span>
                    )}
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
