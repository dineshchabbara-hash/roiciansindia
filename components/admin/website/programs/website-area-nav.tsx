import Link from "next/link";

export type WebsiteArea = "pages" | "programs" | "groups" | "featured" | "media";

const AREAS: Array<{ id: WebsiteArea; label: string; href: string }> = [
  { id: "pages", label: "Pages", href: "/admin/website" },
  { id: "programs", label: "Programs", href: "/admin/website/programs" },
  { id: "groups", label: "Display groups", href: "/admin/website/groups" },
  { id: "featured", label: "Featured Programs", href: "/admin/website/featured" },
  { id: "media", label: "Media", href: "/admin/website/media" },
];

/** Phase 22B-2: switches between the Website Management areas. */
export function WebsiteAreaNav({ current }: { current: WebsiteArea }) {
  return (
    <nav aria-label="Website management" className="border-b">
      <ul className="-mb-px flex flex-wrap gap-1 text-sm">
        {AREAS.map((area) => {
          const active = area.id === current;
          return (
            <li key={area.id}>
              <Link
                href={area.href}
                aria-current={active ? "page" : undefined}
                className={
                  active
                    ? "border-primary text-foreground inline-block border-b-2 px-3 py-2 font-medium"
                    : "text-muted-foreground hover:text-foreground inline-block border-b-2 border-transparent px-3 py-2"
                }
              >
                {area.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export type ProgramSection = "content" | "settings" | "batches" | "history" | "preview";

/** Phase 22B-2: switches between one Program's website screens. */
export function ProgramWebsiteNav({
  documentId,
  current,
}: {
  documentId: string;
  current: ProgramSection;
}) {
  const base = `/admin/website/programs/${documentId}`;
  const items: Array<{ id: ProgramSection; label: string; href: string }> = [
    { id: "content", label: "Content", href: base },
    { id: "settings", label: "Web address and placement", href: `${base}/settings` },
    { id: "batches", label: "Batches on the website", href: `${base}/batches` },
    { id: "history", label: "Version history", href: `${base}/history` },
    { id: "preview", label: "Preview", href: `${base}/preview` },
  ];
  return (
    <nav aria-label="Program website" className="border-b">
      <ul className="-mb-px flex flex-wrap gap-1 text-sm">
        {items.map((item) => {
          const active = item.id === current;
          return (
            <li key={item.id}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={
                  active
                    ? "border-primary text-foreground inline-block border-b-2 px-3 py-2 font-medium"
                    : "text-muted-foreground hover:text-foreground inline-block border-b-2 border-transparent px-3 py-2"
                }
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
