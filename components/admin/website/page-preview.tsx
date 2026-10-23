import type { WebsiteRevisionContent } from "@/lib/data/website";
import type { MediaOption } from "@/lib/data/website-media";
import {
  MediaImage,
  MediaStatusBadge,
} from "@/components/admin/website/media/media-image";
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

type PreviewMedia = Record<string, MediaOption>;

/** A chosen image in the preview, with its alt text and approval status. */
function PreviewImage({
  id,
  media,
  label,
  className,
}: {
  id: string;
  media?: PreviewMedia;
  label: string;
  className?: string;
}) {
  const image = media?.[id];
  if (!media) {
    return <p className="text-muted-foreground text-xs">{label}: an image is set.</p>;
  }
  return (
    <figure className="flex flex-col gap-1">
      <MediaImage
        src={image?.previewUrl ?? null}
        alt={image?.altText ?? ""}
        fit="contain"
        className={className ?? "max-h-80 w-full rounded-md border"}
      />
      <figcaption className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
        <span>{label}.</span>
        {image ? (
          <>
            <span>Alt text: {image.altText ?? "none"}</span>
            {image.status !== "approved" && (
              <>
                <MediaStatusBadge status={image.status} />
                <span className="text-amber-800 dark:text-amber-300">
                  Not Approved: this version cannot be published until it is.
                </span>
              </>
            )}
          </>
        ) : (
          <span className="text-amber-800 dark:text-amber-300">Image not found.</span>
        )}
      </figcaption>
    </figure>
  );
}

function PreviewSection({
  section,
  media,
}: {
  section: EditableSection;
  media?: PreviewMedia;
}) {
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
      {section.imageAssetId && (
        <PreviewImage id={section.imageAssetId} media={media} label="Section image" />
      )}
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
  media,
}: {
  content: WebsiteRevisionContent;
  isLive: boolean;
  /** Phase 22B-3: the chosen images (private, short-lived preview links). */
  media?: PreviewMedia;
}) {
  return (
    <article className="flex flex-col gap-6">
      <p className="text-muted-foreground text-xs">
        Version {content.number}, saved {formatWebsiteTimestamp(content.createdAt)} by{" "}
        {content.createdByName ?? "an admin"}.{" "}
        {isLive ? "This version is live." : "This version is not live."}
      </p>

      {content.heroImageAssetId && (
        <PreviewImage id={content.heroImageAssetId} media={media} label="Main image" />
      )}

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
          <PreviewSection key={section.key} section={section} media={media} />
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
        {content.socialImageAssetId && (
          <div className="mt-3">
            <PreviewImage
              id={content.socialImageAssetId}
              media={media}
              label="Social sharing image"
              className="max-h-40 w-auto max-w-full rounded-md border"
            />
          </div>
        )}
      </section>
    </article>
  );
}
