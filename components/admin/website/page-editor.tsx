"use client";

import Link from "next/link";
import {
  useActionState,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PublicationPanel } from "@/components/admin/website/publication-panel";
import {
  MediaPicker,
  findMedia,
  type EditorMedia,
} from "@/components/admin/website/media/media-picker";
import {
  DOCUMENT_IMAGE_SLOTS,
  SECTION_IMAGE_TYPES,
  UNAPPROVED_IMAGES_MESSAGE,
  contentImageIds,
} from "@/lib/domain/website-media";
import {
  draftStashKey,
  forgetStashWhenOpened,
  keepsRecoveryCopy,
  parseStash,
  removeStash,
  stashWhenOpened,
  useUnsavedChangesGuard,
  useWebsiteDraftCopyCleanup,
  writeStash,
} from "@/components/admin/website/unsaved-changes";
import { saveWebsiteDraftAction, type WebsiteActionState } from "@/lib/actions/website";
import type { WebsiteRevisionContent } from "@/lib/data/website";
import {
  SECTION_TYPES_BY_KIND,
  WEBSITE_LIMITS,
  type WebsiteSectionType,
} from "@/lib/domain/website";
import {
  ITEM_FIELD_LABELS,
  SECTION_FIELDS,
  SECTION_TYPE_LABELS,
  cleanSectionForSave,
  formatWebsiteTimestamp,
  itemFieldsToShow,
  nextSectionKey,
  type AdminPageKind,
  type EditableSection,
  type ItemField,
} from "@/lib/domain/website-admin";

/** A server action with the editor's form state (22B-1 pages or 22B-2 Programs). */
export type WebsiteFormAction = (
  prev: WebsiteActionState,
  formData: FormData,
) => Promise<WebsiteActionState>;

/**
 * What the editor saves, publishes and links to. Website pages (22B-1) use
 * the defaults; Program content (22B-2) passes its own actions and paths.
 */
export type EditorBindings = {
  save?: WebsiteFormAction;
  publish?: WebsiteFormAction;
  unpublish?: WebsiteFormAction;
  /** The document's editor path; preview and history live below it. */
  basePath?: string;
  /** Why publishing is held (shown, and Publish disabled); null when not held. */
  publishHeldReason?: string | null;
  /** "page" or "Program", used in confirmation wording. */
  subject?: string;
};

export type EditorPage = {
  id: string;
  kind: AdminPageKind | "program";
  pageKey: string;
  label: string;
  latestRevisionId: string | null;
  latestRevisionNumber: number;
  publishedRevisionId: string | null;
  publishedRevisionNumber: number | null;
  firstPublishedAt: string | null;
  version: number;
};

type Draft = {
  title: string;
  summary: string;
  seoTitle: string;
  seoDescription: string;
  socialTitle: string;
  socialDescription: string;
  heroImageAssetId: string | null;
  socialImageAssetId: string | null;
  sections: EditableSection[];
};

function draftFrom(content: WebsiteRevisionContent | null): Draft {
  return {
    title: content?.title ?? "",
    summary: content?.summary ?? "",
    seoTitle: content?.seoTitle ?? "",
    seoDescription: content?.seoDescription ?? "",
    socialTitle: content?.socialTitle ?? "",
    socialDescription: content?.socialDescription ?? "",
    heroImageAssetId: content?.heroImageAssetId ?? null,
    socialImageAssetId: content?.socialImageAssetId ?? null,
    sections: content?.sections ?? [],
  };
}

/**
 * A draft read back from this tab's safety copy. Anything malformed is
 * rejected; the server validates the content again when it is saved.
 */
function draftFromStash(value: unknown): Draft | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.title !== "string" || !Array.isArray(v.sections)) return null;
  if (!v.sections.every((s) => s && typeof s === "object" && typeof s.type === "string"))
    return null;
  const text = (x: unknown) => (typeof x === "string" ? x : "");
  const id = (x: unknown) => (typeof x === "string" ? x : null);
  return {
    title: v.title,
    summary: text(v.summary),
    seoTitle: text(v.seoTitle),
    seoDescription: text(v.seoDescription),
    socialTitle: text(v.socialTitle),
    socialDescription: text(v.socialDescription),
    heroImageAssetId: id(v.heroImageAssetId),
    socialImageAssetId: id(v.socialImageAssetId),
    sections: v.sections as EditableSection[],
  };
}

/** The JSON the save action validates (blank optional text becomes null). */
export function draftPayload(draft: Draft, baseRevisionNumber: number) {
  const orNull = (v: string) => (v.trim() === "" ? null : v);
  return {
    baseRevisionNumber,
    title: draft.title,
    summary: orNull(draft.summary),
    seoTitle: orNull(draft.seoTitle),
    seoDescription: orNull(draft.seoDescription),
    socialTitle: orNull(draft.socialTitle),
    socialDescription: orNull(draft.socialDescription),
    heroImageAssetId: draft.heroImageAssetId,
    socialImageAssetId: draft.socialImageAssetId,
    sections: draft.sections.map(cleanSectionForSave),
  };
}

const textareaClass =
  "border-input bg-background focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none aria-invalid:border-destructive";

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="text-destructive text-xs">
      {message}
    </p>
  );
}

function TextField(props: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  max?: number;
  multiline?: boolean;
  rows?: number;
  hint?: string;
  required?: boolean;
}) {
  const {
    id,
    label,
    value,
    onChange,
    error,
    max,
    multiline,
    rows = 3,
    hint,
    required,
  } = props;
  const describedBy =
    [hint ? `${id}-hint` : null, error ? `${id}-error` : null]
      .filter(Boolean)
      .join(" ") || undefined;
  const common = {
    id,
    value,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": describedBy,
    "aria-required": required || undefined,
  };
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={id}>
          {label}
          {required ? <span aria-hidden="true"> *</span> : null}
        </Label>
        {max ? (
          <span
            className={`text-xs ${value.length > max ? "text-destructive" : "text-muted-foreground"}`}
          >
            {value.length}/{max}
          </span>
        ) : null}
      </div>
      {multiline ? (
        <textarea
          {...common}
          rows={rows}
          className={textareaClass}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <Input {...common} onChange={(e) => onChange(e.target.value)} />
      )}
      {hint ? (
        <p id={`${id}-hint`} className="text-muted-foreground text-xs">
          {hint}
        </p>
      ) : null}
      <FieldError id={`${id}-error`} message={error} />
    </div>
  );
}

function SectionCard(props: {
  section: EditableSection;
  index: number;
  count: number;
  errors: Record<string, string[]>;
  onChange: (next: EditableSection) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
  /** Phase 22B-3: image choices; without it images are kept unchanged. */
  media?: EditorMedia;
}) {
  const { section, index, count, errors, onChange, onMove, onRemove, media } = props;
  const type = section.type as WebsiteSectionType;
  const spec = SECTION_FIELDS[type] ?? {
    heading: true,
    body: true,
    cta: false,
    items: null,
  };
  const label = SECTION_TYPE_LABELS[type] ?? section.type;
  const err = (path: string) => errors[`sections.${index}.${path}`]?.[0];
  const idBase = `section-${section.key}`;
  const showHeading = spec.heading || section.heading !== undefined;
  const showBody = spec.body || section.body !== undefined;
  const showCta = spec.cta || section.cta !== undefined;
  const showItems = spec.items !== null || section.items !== undefined;
  const itemFields = itemFieldsToShow(type, section.items);
  const items = section.items ?? [];

  const setItem = (i: number, field: ItemField, value: string) => {
    const next = items.map((item, j) => (j === i ? { ...item, [field]: value } : item));
    onChange({ ...section, items: next });
  };
  const moveItem = (i: number, delta: -1 | 1) => {
    const j = i + delta;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    onChange({ ...section, items: next });
  };

  return (
    <li
      className="rounded-md border p-4"
      aria-labelledby={`${idBase}-title`}
      data-section-key={section.key}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col">
          <h3 id={`${idBase}-title`} className="text-sm font-semibold">
            {index + 1}. {label}
          </h3>
          <span className="text-muted-foreground text-xs">Key: {section.key}</span>
        </div>
        <div className="flex items-center gap-1">
          <label className="mr-2 flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              checked={section.visible}
              onChange={(e) => onChange({ ...section, visible: e.target.checked })}
            />
            Visible
          </label>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label={`Move section ${index + 1} up`}
            disabled={index === 0}
            onClick={() => onMove(-1)}
          >
            <ArrowUp />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label={`Move section ${index + 1} down`}
            disabled={index === count - 1}
            onClick={() => onMove(1)}
          >
            <ArrowDown />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label={`Remove section ${index + 1}`}
            onClick={onRemove}
          >
            <Trash2 />
          </Button>
        </div>
      </div>

      {err("type") || err("key") ? (
        <p role="alert" className="text-destructive mb-2 text-xs">
          {err("type") ?? err("key")}
        </p>
      ) : null}

      <div className="flex flex-col gap-3">
        {showHeading && (
          <TextField
            id={`${idBase}-heading`}
            label="Heading"
            value={section.heading ?? ""}
            max={WEBSITE_LIMITS.sectionHeading}
            error={err("heading")}
            onChange={(v) => onChange({ ...section, heading: v })}
          />
        )}
        {showBody && (
          <TextField
            id={`${idBase}-body`}
            label="Text"
            multiline
            rows={5}
            value={section.body ?? ""}
            max={WEBSITE_LIMITS.sectionBody}
            hint="Plain text. Leave a blank line between paragraphs."
            error={err("body")}
            onChange={(v) => onChange({ ...section, body: v })}
          />
        )}
        {showCta && (
          <fieldset className="grid gap-3 sm:grid-cols-2">
            <legend className="mb-1 text-xs font-medium">Button (optional)</legend>
            <TextField
              id={`${idBase}-cta-label`}
              label="Button label"
              value={section.cta?.label ?? ""}
              max={WEBSITE_LIMITS.ctaLabel}
              error={err("cta.label") ?? err("cta")}
              onChange={(v) =>
                onChange({ ...section, cta: { label: v, href: section.cta?.href ?? "" } })
              }
            />
            <TextField
              id={`${idBase}-cta-href`}
              label="Button link"
              value={section.cta?.href ?? ""}
              hint="A site path such as /programs, an https:// address, mailto: or tel:."
              error={err("cta.href")}
              onChange={(v) =>
                onChange({
                  ...section,
                  cta: { label: section.cta?.label ?? "", href: v },
                })
              }
            />
          </fieldset>
        )}
        {showItems && (
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-1 text-xs font-medium">
              {spec.items?.label ?? "Items"}
            </legend>
            {err("items") ? (
              <p className="text-destructive text-xs">{err("items")}</p>
            ) : null}
            <ol className="flex flex-col gap-3">
              {items.map((item, i) => (
                <li key={i} className="bg-muted/30 flex flex-col gap-2 rounded-md p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium">Item {i + 1}</span>
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label={`Move item ${i + 1} up`}
                        disabled={i === 0}
                        onClick={() => moveItem(i, -1)}
                      >
                        <ArrowUp />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label={`Move item ${i + 1} down`}
                        disabled={i === items.length - 1}
                        onClick={() => moveItem(i, 1)}
                      >
                        <ArrowDown />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label={`Remove item ${i + 1}`}
                        onClick={() =>
                          onChange({ ...section, items: items.filter((_, j) => j !== i) })
                        }
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </div>
                  {err(`items.${i}`) ? (
                    <p className="text-destructive text-xs">{err(`items.${i}`)}</p>
                  ) : null}
                  <div className="grid gap-2 sm:grid-cols-2">
                    {itemFields.map((field) => (
                      <TextField
                        key={field}
                        id={`${idBase}-item-${i}-${field}`}
                        label={ITEM_FIELD_LABELS[field]}
                        value={item[field] ?? ""}
                        multiline={field === "text" || field === "answer"}
                        error={err(`items.${i}.${field}`)}
                        onChange={(v) => setItem(i, field, v)}
                      />
                    ))}
                  </div>
                </li>
              ))}
            </ol>
            <div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={items.length >= WEBSITE_LIMITS.items}
                onClick={() => onChange({ ...section, items: [...items, {}] })}
              >
                <Plus /> Add item
              </Button>
            </div>
          </fieldset>
        )}
        {spec.note ? <p className="text-muted-foreground text-xs">{spec.note}</p> : null}
        {media && SECTION_IMAGE_TYPES.has(section.type) ? (
          <MediaPicker
            label="Section image"
            value={section.imageAssetId ?? null}
            media={media}
            onChange={(id) => {
              const next: EditableSection = { ...section };
              if (id) next.imageAssetId = id;
              else delete next.imageAssetId;
              onChange(next);
            }}
          />
        ) : section.imageAssetId ? (
          <p className="text-muted-foreground text-xs">
            This section has an image, which is kept unchanged when you save.
          </p>
        ) : null}
      </div>
    </li>
  );
}

const initialState: WebsiteActionState = {};

/**
 * Phase 22B-1 structured page editor. Content is edited in plain, structured
 * fields only: no HTML and no code. Saving creates a new draft version; nothing
 * is public until it is published. If someone else saved first, the user's
 * text stays on screen and they choose what to do next (lost-update
 * protection; the database refuses any save based on an older version).
 */
const noSubscription = () => () => {};

export function PageEditor({
  page,
  content,
  stashOwnerId,
  bindings,
  media,
}: {
  page: EditorPage;
  content: WebsiteRevisionContent | null;
  /**
   * The signed-in user's id. Enables the per-tab unsaved-draft safety copy
   * (never for legal pages) and its cleanup.
   */
  stashOwnerId?: string;
  bindings?: EditorBindings;
  /** Phase 22B-3: image choices. Without it, images are kept unchanged. */
  media?: EditorMedia;
}) {
  const saveAction = bindings?.save ?? saveWebsiteDraftAction;
  const basePath = bindings?.basePath ?? `/admin/website/pages/${page.id}`;
  const [draft, setDraft] = useState<Draft>(() => draftFrom(content));
  const [base, setBase] = useState(page.latestRevisionNumber);
  const [latestRevisionId, setLatestRevisionId] = useState(page.latestRevisionId);
  const [dirty, setDirty] = useState(false);
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  const [newType, setNewType] = useState<string>(SECTION_TYPES_BY_KIND[page.kind][0]);
  const formId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const stashKey =
    stashOwnerId && keepsRecoveryCopy(page.kind)
      ? draftStashKey(stashOwnerId, page.id)
      : null;
  // Set when the user confirms Sign out, so a pending copy is never written
  // after their copies have been cleared.
  const copyWritesStopped = useRef(false);

  const [state, formAction, isSaving] = useActionState(
    async (prev: WebsiteActionState, formData: FormData) => {
      const result = await saveAction(prev, formData);
      if (result.saved) {
        setBase(result.saved.revisionNumber);
        setLatestRevisionId(result.saved.revisionId);
        setDirty(false);
        setConfirmOverwrite(false);
        if (stashKey) removeStash(stashKey);
      }
      return result;
    },
    initialState,
  );

  // Warns before any navigation would discard unsaved changes (links, Back/
  // Forward, forms outside the editor, closing or reloading the tab).
  useUnsavedChangesGuard(dirty, containerRef);

  // Removes copies this user may not be offered when the editor opens, and
  // all of their copies when they confirm Sign out.
  useWebsiteDraftCopyCleanup(stashOwnerId, () => {
    copyWritesStopped.current = true;
  });

  // Safety copy of unsaved changes in this browser tab (not for legal pages).
  useEffect(() => {
    if (!stashKey || !dirty) return;
    const timer = window.setTimeout(() => {
      if (copyWritesStopped.current) return;
      writeStash(stashKey, {
        base,
        savedAt: new Date().toISOString(),
        kind: page.kind,
        draft,
      });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [stashKey, dirty, draft, base, page.kind]);
  useEffect(
    () => () => {
      if (stashKey) forgetStashWhenOpened(stashKey);
    },
    [stashKey],
  );
  const openedStash = useSyncExternalStore(
    noSubscription,
    () => (stashKey ? stashWhenOpened(stashKey) : null),
    () => null,
  );
  const [stashHandled, setStashHandled] = useState(false);
  const savedContent = useMemo(
    () => JSON.stringify(draftPayload(draftFrom(content), 0)),
    [content],
  );
  const recoverable = useMemo(() => {
    const stash = parseStash<unknown>(openedStash);
    const restored = stash ? draftFromStash(stash.draft) : null;
    if (!stash || !restored) return null;
    if (JSON.stringify(draftPayload(restored, 0)) === savedContent) return null;
    return { ...stash, draft: restored };
  }, [openedStash, savedContent]);
  const showRecovery = recoverable !== null && !stashHandled;

  const errors = state.fieldErrors ?? {};
  const update = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setDirty(true);
  };
  const setSection = (index: number, next: EditableSection) =>
    update({ sections: draft.sections.map((s, i) => (i === index ? next : s)) });
  const moveSection = (index: number, delta: -1 | 1) => {
    const j = index + delta;
    if (j < 0 || j >= draft.sections.length) return;
    const next = [...draft.sections];
    [next[index], next[j]] = [next[j], next[index]];
    update({ sections: next });
  };
  const addSection = () => {
    const type = newType as WebsiteSectionType;
    const key = nextSectionKey(
      type,
      draft.sections.map((s) => s.key),
    );
    const spec = SECTION_FIELDS[type];
    update({
      sections: [
        ...draft.sections,
        { key, type, visible: true, ...(spec?.items ? { items: [{}] } : {}) },
      ],
    });
  };

  const allowedTypes = SECTION_TYPES_BY_KIND[page.kind];
  const slots = DOCUMENT_IMAGE_SLOTS[page.kind];
  // Publishing needs every chosen image to be Approved (the database refuses
  // otherwise); say so before the Admin tries.
  const unapprovedImages = media
    ? contentImageIds(draft).filter((id) => findMedia(media, id)?.status !== "approved")
    : [];
  const stale = state.stale && !state.saved ? state.stale : null;
  const fieldErrorCount = Object.keys(errors).length;

  return (
    <div ref={containerRef} className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex min-w-0 flex-col gap-6">
        {showRecovery && recoverable && (
          <div
            role="alert"
            className="rounded-md border border-sky-300 bg-sky-50 p-4 text-sm dark:border-sky-800 dark:bg-sky-950"
          >
            <p className="font-medium">
              Unsaved changes to this page were found from earlier in this browser tab.
            </p>
            <p className="mt-1">
              They were last edited on {formatWebsiteTimestamp(recoverable.savedAt)} and
              started from version {recoverable.base}. If someone saved a newer version
              since, saving them will warn you first.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  setDraft(recoverable.draft);
                  setBase(recoverable.base);
                  setDirty(true);
                  setStashHandled(true);
                }}
              >
                Restore unsaved changes
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  if (stashKey) removeStash(stashKey);
                  setStashHandled(true);
                }}
              >
                Discard them
              </Button>
            </div>
          </div>
        )}
        {state.error && !stale && (
          <div
            role="alert"
            className="border-destructive/40 bg-destructive/5 rounded-md border p-3 text-sm"
          >
            <p className="text-destructive font-medium">{state.error}</p>
            {fieldErrorCount > 0 && (
              <ul className="text-destructive mt-1 list-disc pl-5 text-xs">
                {Object.entries(errors)
                  .slice(0, 8)
                  .map(([path, messages]) => (
                    <li key={path}>{messages[0]}</li>
                  ))}
              </ul>
            )}
          </div>
        )}

        {stale && (
          <div
            role="alert"
            className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-800 dark:bg-amber-950"
          >
            <p className="font-medium">{state.error}</p>
            <p className="mt-1">
              Your changes are still here and have not been saved. The latest saved
              version is now version {stale.latestRevisionNumber}.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button asChild size="sm" variant="outline">
                <Link href={basePath} target="_blank" rel="noopener">
                  Open the latest version in a new tab
                </Link>
              </Button>
              {!confirmOverwrite ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setConfirmOverwrite(true)}
                >
                  Save my version anyway…
                </Button>
              ) : (
                <form action={formAction} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="documentId" value={page.id} />
                  <input
                    type="hidden"
                    name="draft"
                    value={JSON.stringify(
                      draftPayload(draft, stale.latestRevisionNumber),
                    )}
                  />
                  <span className="text-xs">
                    This saves your version as the newest draft. Version{" "}
                    {stale.latestRevisionNumber} stays in the history and can be restored.
                  </span>
                  <Button type="submit" size="sm" disabled={isSaving}>
                    Confirm: save my version
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setConfirmOverwrite(false)}
                  >
                    Cancel
                  </Button>
                </form>
              )}
            </div>
          </div>
        )}

        {state.message && (
          <p
            role="status"
            className="rounded-md border border-green-300 bg-green-50 p-3 text-sm text-green-900 dark:border-green-900 dark:bg-green-950 dark:text-green-200"
          >
            {state.message}
          </p>
        )}

        <form
          id={formId}
          action={formAction}
          aria-label={`Edit ${page.label}`}
          className="flex flex-col gap-6"
          noValidate
        >
          <input type="hidden" name="documentId" value={page.id} />
          <input
            type="hidden"
            name="draft"
            value={JSON.stringify(draftPayload(draft, base))}
          />

          <section aria-labelledby="page-details-heading" className="flex flex-col gap-4">
            <h2 id="page-details-heading" className="text-base font-semibold">
              Page details
            </h2>
            <TextField
              id="page-title"
              label="Title"
              required
              value={draft.title}
              max={WEBSITE_LIMITS.title}
              error={errors.title?.[0]}
              onChange={(v) => update({ title: v })}
            />
            <TextField
              id="page-summary"
              label="Summary"
              multiline
              value={draft.summary}
              max={WEBSITE_LIMITS.summary}
              hint="A short introduction shown near the top of the page."
              error={errors.summary?.[0]}
              onChange={(v) => update({ summary: v })}
            />
            {media && (slots.main || slots.social) ? (
              <fieldset className="flex flex-col gap-4 rounded-md border p-3">
                <legend className="px-1 text-sm font-medium">Images</legend>
                {slots.main && (
                  <MediaPicker
                    label="Main image"
                    hint="Shown at the top of the page."
                    value={draft.heroImageAssetId}
                    media={media}
                    onChange={(id) => update({ heroImageAssetId: id })}
                  />
                )}
                {slots.social && (
                  <MediaPicker
                    label="Social sharing image"
                    hint="Shown when the page is shared on social media."
                    value={draft.socialImageAssetId}
                    media={media}
                    onChange={(id) => update({ socialImageAssetId: id })}
                  />
                )}
              </fieldset>
            ) : (
              (draft.heroImageAssetId || draft.socialImageAssetId) && (
                <p className="text-muted-foreground text-xs">
                  This page has images, which are kept unchanged when you save.
                </p>
              )
            )}
          </section>

          <section aria-labelledby="sections-heading" className="flex flex-col gap-3">
            <h2 id="sections-heading" className="text-base font-semibold">
              Sections
            </h2>
            {errors.sections?.[0] ? (
              <p className="text-destructive text-xs">{errors.sections[0]}</p>
            ) : null}
            {draft.sections.length === 0 ? (
              <p className="text-muted-foreground text-sm">No sections yet.</p>
            ) : (
              <ol className="flex flex-col gap-3">
                {draft.sections.map((section, index) => (
                  <SectionCard
                    key={section.key}
                    section={section}
                    index={index}
                    count={draft.sections.length}
                    errors={errors}
                    onChange={(next) => setSection(index, next)}
                    onMove={(delta) => moveSection(index, delta)}
                    onRemove={() =>
                      update({ sections: draft.sections.filter((_, i) => i !== index) })
                    }
                    media={media}
                  />
                ))}
              </ol>
            )}
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="new-section-type">Add a section</Label>
                <select
                  id="new-section-type"
                  value={newType}
                  onChange={(e) => setNewType(e.target.value)}
                  className="border-input bg-background h-9 rounded-md border px-3 text-sm"
                >
                  {allowedTypes.map((t) => (
                    <option key={t} value={t}>
                      {SECTION_TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={addSection}
                disabled={draft.sections.length >= WEBSITE_LIMITS.sections}
              >
                <Plus /> Add section
              </Button>
            </div>
          </section>

          <section aria-labelledby="seo-heading" className="flex flex-col gap-4">
            <h2 id="seo-heading" className="text-base font-semibold">
              Search and social sharing
            </h2>
            <div className="grid gap-4 md:grid-cols-2">
              <TextField
                id="seo-title"
                label="Search title"
                value={draft.seoTitle}
                max={WEBSITE_LIMITS.seoTitle}
                error={errors.seoTitle?.[0]}
                onChange={(v) => update({ seoTitle: v })}
              />
              <TextField
                id="social-title"
                label="Social sharing title"
                value={draft.socialTitle}
                max={WEBSITE_LIMITS.socialTitle}
                error={errors.socialTitle?.[0]}
                onChange={(v) => update({ socialTitle: v })}
              />
              <TextField
                id="seo-description"
                label="Search description"
                multiline
                value={draft.seoDescription}
                max={WEBSITE_LIMITS.seoDescription}
                error={errors.seoDescription?.[0]}
                onChange={(v) => update({ seoDescription: v })}
              />
              <TextField
                id="social-description"
                label="Social sharing description"
                multiline
                value={draft.socialDescription}
                max={WEBSITE_LIMITS.socialDescription}
                error={errors.socialDescription?.[0]}
                onChange={(v) => update({ socialDescription: v })}
              />
            </div>
          </section>
        </form>
        {/* Phones and tablets: keep Save reachable without scrolling to the side panel. */}
        <div className="bg-background/95 sticky bottom-0 z-10 -mx-4 flex items-center justify-between gap-3 border-t px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:hidden">
          <span className="text-muted-foreground text-xs">
            {dirty
              ? "Unsaved changes"
              : base === 0
                ? "Nothing saved yet"
                : `Saved as version ${base}`}
          </span>
          <Button type="submit" form={formId} size="sm" disabled={isSaving || !dirty}>
            {isSaving ? "Saving…" : "Save draft"}
          </Button>
        </div>
      </div>

      <aside className="flex flex-col gap-4 lg:sticky lg:top-4 lg:self-start">
        <div className="flex flex-col gap-2 rounded-md border p-4">
          <h2 className="text-sm font-semibold">Draft</h2>
          <p className="text-muted-foreground text-xs" aria-live="polite">
            {dirty
              ? "You have unsaved changes."
              : base === 0
                ? "Nothing saved yet."
                : `Latest saved version: ${base}.`}
          </p>
          <Button type="submit" form={formId} disabled={isSaving || !dirty}>
            {isSaving ? "Saving…" : "Save draft"}
          </Button>
          <p className="text-muted-foreground text-xs">
            Saving never changes the live page. Preview shows the latest saved version.
          </p>
        </div>

        <PublicationPanel
          page={page}
          latestRevisionId={latestRevisionId}
          latestRevisionNumber={base}
          dirty={dirty}
          bindings={{ ...bindings, basePath }}
          imageBlockedReason={
            unapprovedImages.length > 0 ? UNAPPROVED_IMAGES_MESSAGE : null
          }
        />
      </aside>
    </div>
  );
}
