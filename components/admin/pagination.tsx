import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * Generic page-number pagination for any Admin list screen. Preserves every
 * existing query param except `page` when building prev/next links, so
 * search/filter state survives pagination.
 */
export function Pagination({
  page,
  pageSize,
  total,
  basePath,
  searchParams,
}: {
  page: number;
  pageSize: number;
  total: number;
  basePath: string;
  searchParams: Record<string, string | undefined>;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;

  function hrefForPage(targetPage: number): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams)) {
      if (value) params.set(key, value);
    }
    params.set("page", String(targetPage));
    return `${basePath}?${params.toString()}`;
  }

  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-4 pt-2">
      <p className="text-muted-foreground text-sm">
        Page {page} of {totalPages} ({total} total)
      </p>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} asChild={page > 1}>
          {page > 1 ? (
            <Link href={hrefForPage(page - 1)}>Previous</Link>
          ) : (
            <span>Previous</span>
          )}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= totalPages}
          asChild={page < totalPages}
        >
          {page < totalPages ? (
            <Link href={hrefForPage(page + 1)}>Next</Link>
          ) : (
            <span>Next</span>
          )}
        </Button>
      </div>
    </nav>
  );
}
