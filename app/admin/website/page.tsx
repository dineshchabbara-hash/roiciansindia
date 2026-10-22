import { redirect } from "next/navigation";
import { WebsitePagesTable } from "@/components/admin/website/website-pages-table";
import { CreatePageForm } from "@/components/admin/website/create-page-form";
import { getCurrentUserContext } from "@/lib/auth/session";
import { listWebsitePages } from "@/lib/data/website";
import { isAdminOrSuperAdmin, roleHomePath } from "@/lib/domain/rbac";

export const dynamic = "force-dynamic";

/**
 * Phase 22B-1: Website Management dashboard (Admin and Super Admin). Lists
 * every supported page with its draft/published status. Program pages are
 * managed in 22B-2. Nothing here is public until an Admin publishes it, and
 * the public website itself arrives in later stages (22D-22G).
 */
export default async function WebsitePage() {
  const user = await getCurrentUserContext();
  if (!user) redirect("/login/admin");
  if (!isAdminOrSuperAdmin(user.role)) redirect(roleHomePath(user.role));

  const result = await listWebsitePages();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Website</h1>
        <p className="text-muted-foreground max-w-3xl text-sm">
          Manage the content of the public ROICIANS website. Changes are saved as drafts
          and stay private until you publish them. Every save, publication and restore is
          kept in the page history and the audit log.
        </p>
      </div>

      {result.ok ? (
        <>
          <WebsitePagesTable pages={result.data} />
          <section aria-labelledby="legal-pages-heading" className="flex flex-col gap-2">
            <h2 id="legal-pages-heading" className="text-base font-semibold">
              Legal pages
            </h2>
            <p className="text-muted-foreground max-w-3xl text-sm">
              Legal pages can be drafted and previewed now. Publishing stays blocked until
              their wording has business and legal approval.
            </p>
            <CreatePageForm kind="legal" />
          </section>
        </>
      ) : (
        <p role="alert" className="text-destructive text-sm">
          {result.error}
        </p>
      )}
    </div>
  );
}
