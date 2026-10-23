import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import {
  ProgramWebsiteNav,
  type ProgramSection,
} from "@/components/admin/website/programs/website-area-nav";
import type { ProgramWebsiteDetail } from "@/lib/data/website-programs";
import {
  LMS_PROGRAM_STATUS_LABELS,
  programCanBePublished,
} from "@/lib/domain/website-programs";

/** Shared heading and tabs for one Program's website screens. */
export function ProgramHeader({
  detail,
  section,
  title,
}: {
  detail: ProgramWebsiteDetail;
  section: ProgramSection;
  title?: string;
}) {
  const { program, document } = detail;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <Link
          href="/admin/website/programs"
          className="text-muted-foreground text-sm underline-offset-4 hover:underline"
        >
          ← All Programs
        </Link>
        <h1 className="text-2xl font-semibold">{title ?? `Program: ${program.name}`}</h1>
        <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-sm">
          <span>{program.code}</span>
          <Badge
            variant={programCanBePublished(program.status) ? "success" : "secondary"}
          >
            {LMS_PROGRAM_STATUS_LABELS[program.status]}
          </Badge>
          <code className="text-xs">/programs/{document.slug}</code>
        </div>
      </div>
      <ProgramWebsiteNav documentId={document.id} current={section} />
    </div>
  );
}
