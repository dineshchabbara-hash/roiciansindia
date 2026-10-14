import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getCurrentUserContext } from "@/lib/auth/session";
import { listAuditLogs } from "@/lib/data/audit-viewer";
import {
  AUDIT_ENTITY_TYPES,
  auditFilterQuery,
  parseAuditFilters,
} from "@/lib/domain/audit-viewer";
import { isAdminOrSuperAdmin, isSuperAdmin, roleHomePath } from "@/lib/domain/rbac";

export const dynamic = "force-dynamic";

const timeFormat = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  dateStyle: "medium",
  timeStyle: "short",
});

/**
 * Phase 21C — read-only Audit Log. Super Admin sees every entry; Admin
 * every entry except Admin account management (enforced by RLS). Nothing
 * here can change or delete an entry.
 */
export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUserContext();
  if (!user) redirect("/login/admin");
  if (!isAdminOrSuperAdmin(user.role)) redirect(roleHomePath(user.role));

  const filters = parseAuditFilters(await searchParams);
  const result = await listAuditLogs(filters);
  const entityTypes = AUDIT_ENTITY_TYPES.filter(
    (type) => type !== "admin_account" || isSuperAdmin(user.role),
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Audit Log</h1>
        <p className="text-muted-foreground text-sm">
          A read-only record of recorded actions, newest first (times in IST).
          {isSuperAdmin(user.role)
            ? ""
            : " Admin account management is visible to Super Admins only."}
        </p>
      </div>

      <form
        method="get"
        aria-label="Filter audit log"
        className="grid gap-3 md:grid-cols-6"
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="audit-from">From</Label>
          <Input
            id="audit-from"
            name="from"
            type="date"
            defaultValue={filters.from ?? ""}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="audit-to">To</Label>
          <Input id="audit-to" name="to" type="date" defaultValue={filters.to ?? ""} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="audit-action">Action</Label>
          <Input
            id="audit-action"
            name="action"
            placeholder="e.g. refund. or student.create"
            defaultValue={filters.action ?? ""}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="audit-entity">Record type</Label>
          <select
            id="audit-entity"
            name="entity"
            defaultValue={filters.entityType ?? ""}
            className="border-input bg-background h-9 rounded-md border px-3 text-sm"
          >
            <option value="">All</option>
            {entityTypes.map((type) => (
              <option key={type} value={type}>
                {type.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="audit-role">Actor</Label>
          <select
            id="audit-role"
            name="role"
            defaultValue={filters.actorRole ?? ""}
            className="border-input bg-background h-9 rounded-md border px-3 text-sm"
          >
            <option value="">All</option>
            <option value="super_admin">Super Admin</option>
            <option value="admin">Admin</option>
            <option value="trainer">Trainer</option>
            <option value="student">Student</option>
            <option value="system">System</option>
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="audit-id">Record id</Label>
          <Input id="audit-id" name="id" defaultValue={filters.entityId ?? ""} />
        </div>
        <div className="flex gap-2 md:col-span-6">
          <Button type="submit" size="sm">
            Apply filters
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href="/admin/audit-log">Clear</Link>
          </Button>
        </div>
      </form>

      {!result.ok ? (
        <p role="alert" className="text-destructive text-sm">
          {result.error}
        </p>
      ) : (
        <Card>
          <CardContent className="flex flex-col gap-4 pt-6">
            <p className="text-muted-foreground text-sm">
              {result.data.total === 0
                ? "No entries match these filters."
                : `${result.data.total} entr${result.data.total === 1 ? "y" : "ies"}`}
            </p>
            {result.data.rows.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm" aria-label="Audit log entries">
                  <thead>
                    <tr className="text-muted-foreground border-b text-left text-xs">
                      <th className="py-2 pr-4 font-medium">When</th>
                      <th className="py-2 pr-4 font-medium">Action</th>
                      <th className="py-2 pr-4 font-medium">Actor</th>
                      <th className="py-2 pr-4 font-medium">Record</th>
                      <th className="py-2 pr-4 font-medium">Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.data.rows.map((row) => (
                      <tr key={row.id} className="border-b align-top last:border-0">
                        <td className="py-2 pr-4 whitespace-nowrap">
                          {timeFormat.format(new Date(row.createdAt))}
                        </td>
                        <td className="py-2 pr-4 font-mono text-xs">{row.action}</td>
                        <td className="py-2 pr-4">
                          {row.actorName ?? "—"}
                          <span className="text-muted-foreground block text-xs">
                            {(row.actorRole ?? "system").replace("_", " ")}
                          </span>
                        </td>
                        <td className="py-2 pr-4">
                          {row.entityType.replace(/_/g, " ")}
                          <span className="text-muted-foreground block font-mono text-xs break-all">
                            {row.entityId}
                          </span>
                        </td>
                        <td className="py-2 pr-4 text-xs">
                          {row.after.length === 0 && row.before.length === 0 ? (
                            "—"
                          ) : (
                            <dl className="grid gap-0.5">
                              {row.after.map((item) => (
                                <div key={`a-${item.key}`} className="flex gap-1">
                                  <dt className="text-muted-foreground">{item.key}:</dt>
                                  <dd className="break-all">{item.value}</dd>
                                </div>
                              ))}
                              {row.before.length > 0 && (
                                <div className="text-muted-foreground mt-1">
                                  before:{" "}
                                  {row.before
                                    .map((item) => `${item.key}: ${item.value}`)
                                    .join("; ")}
                                </div>
                              )}
                            </dl>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {result.data.total > result.data.pageSize && (
              <nav
                aria-label="Audit log pages"
                className="flex items-center gap-3 text-sm"
              >
                {result.data.page > 1 && (
                  <Link
                    className="underline"
                    href={`/admin/audit-log${auditFilterQuery(filters, result.data.page - 1)}`}
                  >
                    Newer
                  </Link>
                )}
                <span className="text-muted-foreground">
                  Page {result.data.page} of{" "}
                  {Math.ceil(result.data.total / result.data.pageSize)}
                </span>
                {result.data.page * result.data.pageSize < result.data.total && (
                  <Link
                    className="underline"
                    href={`/admin/audit-log${auditFilterQuery(filters, result.data.page + 1)}`}
                  >
                    Older
                  </Link>
                )}
              </nav>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
