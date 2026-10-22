import type { WebsiteRevisionContent } from "@/lib/data/website";
import type { WebsiteSectionType } from "@/lib/domain/website";
import {
  ITEM_FIELDS,
  ITEM_FIELD_LABELS,
  SECTION_TYPE_LABELS,
  bodyParagraphs,
  formatWebsiteTimestamp,
  type EditableSection,
} from "@/lib/domain/website-admin";

function Paragraphs({ body }: { body?: string }) {
  return (
    <>
      {bodyParagraphs(body).map((p, i) => (
        <p key={i} className="leading-relaxed whitespace-pre-line">
          {p}
        </p>
      ))}
    </>
  );
}

function PreviewSection({ section }: { section: EditableSection }) {
  const label = SECTION_TYPE_LABELS[section.type as WebsiteSectionType] ?? section.type;
  return (
    <section
      aria-label={`${label} section${section.visible ? "" : " (hidden)"}`}
      className={`flex flex-col gap-3 rounded-md border p-5 ${
        section.visible ? "" : "border-dashed opacity-60"
      }`}
    >
      <div className="text-muted-foreground flex items-center justify-between text-xs">
        <span>{label}</span>
        {!section.visible && <span>Hidden: not shown on the website</span>}
      </div>
      {section.heading && <h3 className="text-xl font-semibold">{section.heading}</h3>}
      <Paragraphs body={section.body} />
      {section.type === "program_showcase" && (
        <p className="bg-muted/40 text-muted-foreground rounded-md p-3 text-sm">
          Featured Programs appear here from published Program records.
        </p>
      )}
      {section.items && section.items.length > 0 && (
        <ul className="flex flex-col gap-2">
          {section.items.map((item, i) => (
            <li key={i} className="bg-muted/30 rounded-md p-3 text-sm">
              {ITEM_FIELDS.filter((f) => item[f]).map((field) => (
                <p key={field}>
                  <span className="text-muted-foreground text-xs">
                    {ITEM_FIELD_LABELS[field]}:{" "}
                  </span>
                  <span
                    className={
                      field === "title" || field === "question" ? "font-medium" : ""
                    }
                  >
                    {item[field]}
                  </span>
                </p>
              ))}
            </li>
          ))}
        </ul>
      )}
      {section.cta && (
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <span className="bg-primary text-primary-foreground rounded-md px-3 py-1.5 font-medium">
            {section.cta.label}
          </span>
          <span className="text-muted-foreground text-xs">
            links to {section.cta.href}
          </span>
        </p>
      )}
    </section>
  );
}

/**
 * Phase 22B-1 structured preview: the saved content in reading order, with
 * hidden sections shown dimmed. It shows structure, not the final public
 * design (the public pages arrive in 22D-22G). Every value is rendered as
 * text; no markup from content is ever interpreted.
 */
export function PagePreview({
  content,
  isLive,
}: {
  content: WebsiteRevisionContent;
  isLive: boolean;
}) {
  return (
    <article className="flex flex-col gap-6">
      <p className="text-muted-foreground text-xs">
        Version {content.number}, saved {formatWebsiteTimestamp(content.createdAt)} by{" "}
        {content.createdByName ?? "an admin"}.{" "}
        {isLive ? "This version is live." : "This version is not live."}
      </p>

      <header className="flex flex-col gap-2">
        <h2 className="text-3xl font-semibold">{content.title}</h2>
        {content.summary && (
          <p className="text-muted-foreground text-lg whitespace-pre-line">
            {content.summary}
          </p>
        )}
      </header>

      {content.sections.length === 0 ? (
        <p className="text-muted-foreground text-sm">This version has no sections.</p>
      ) : (
        content.sections.map((section) => (
          <PreviewSection key={section.key} section={section} />
        ))
      )}

      <section
        aria-label="Search and social sharing"
        className="rounded-md border p-4 text-sm"
      >
        <h3 className="mb-2 font-semibold">Search and social sharing</h3>
        <dl className="grid gap-x-6 gap-y-2 md:grid-cols-2">
          {[
            ["Search title", content.seoTitle],
            ["Search description", content.seoDescription],
            ["Social sharing title", content.socialTitle],
            ["Social sharing description", content.socialDescription],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-muted-foreground text-xs">{label}</dt>
              <dd>{value ?? <span className="text-muted-foreground">Not set</span>}</dd>
            </div>
          ))}
        </dl>
      </section>
    </article>
  );
}
