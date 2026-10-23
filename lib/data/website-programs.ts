import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { DataResult } from "@/lib/data/dashboard";
import {
  REVISION_COLUMNS,
  adminNames,
  isUuid,
  toContent,
  type RevisionRow,
  type WebsiteRevisionContent,
  type WriteResult,
} from "@/lib/data/website";
import { websiteErrorKind } from "@/lib/domain/website";
import { websitePageStatus, type WebsitePageStatus } from "@/lib/domain/website-admin";
import {
  programWebsiteMessage,
  type BatchPublicationRow,
  type LmsBatchStatus,
  type LmsProgramStatus,
} from "@/lib/domain/website-programs";
import type { WebsiteRegistrationState } from "@/lib/supabase/database.types";

/**
 * Phase 22B-2: Program Website Management data access.
 *
 * Same rules as 22B-1 (lib/data/website.ts): every read and write runs through
 * the caller's OWN session. Reads use the Admin/Super Admin RLS read policies;
 * writes go only through the Phase 22A database functions, which re-check the
 * active Admin or Super Admin role, enforce version checks and every content
 * rule, and write the audit log. No service-role key and no audit rows here.
 *
 * Privacy: only the Program fields an Admin needs to recognise a Program (id,
 * code, internal name, status) and the Batch fields needed to recognise a
 * Batch (id, internal name, start date, status) are read. Fees, tax, capacity,
 * meeting links, locations, notes and Trainer data are never selected.
 */

type Client = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export const PROGRAM_WEBSITE_NOT_FOUND =
  "This Program's website content could not be found.";

export type ProgramInfo = {
  id: string;
  code: string;
  /** The LMS Program name (internal; the public headline is in the content). */
  name: string;
  status: LmsProgramStatus;
};

export type ProgramPlacement = {
  displayGroupId: string | null;
  displayGroupName: string | null;
  isFeatured: boolean;
  featuredOrder: number | null;
  displayOrder: number | null;
};

export type ProgramWebsiteDocument = {
  id: string;
  slug: string;
  status: WebsitePageStatus;
  /** Headline of the latest saved version, if any. */
  title: string | null;
  latestRevisionId: string | null;
  latestRevisionNumber: number;
  publishedRevisionId: string | null;
  /** Document version, for placement, slug and unpublish (optimistic concurrency). */
  version: number;
  firstPublishedAt: string | null;
  publishedAt: string | null;
  unpublishedAt: string | null;
  updatedAt: string;
  placement: ProgramPlacement;
};

export type ProgramWebsiteSummary = {
  program: ProgramInfo;
  document: ProgramWebsiteDocument | null;
};

export type ProgramWebsiteDetail = {
  program: ProgramInfo;
  document: ProgramWebsiteDocument & {
    publishedRevisionNumber: number | null;
    updatedByName: string | null;
    publishedByName: string | null;
  };
  latest: WebsiteRevisionContent | null;
};

export type DisplayGroup = {
  id: string;
  name: string;
  description: string | null;
  displayOrder: number;
  isVisible: boolean;
  version: number;
  /** Program website entries placed in this group. */
  programCount: number;
};

export type ProgramBatch = {
  id: string;
  /** The LMS Batch name (internal; never shown publicly). */
  name: string;
  startDate: string;
  status: LmsBatchStatus;
  publication: BatchPublicationRow | null;
};

const PROGRAM_COLUMNS = "id, program_code, name, status";
const DOC_COLUMNS =
  "id, kind, program_id, slug, display_group_id, is_featured, featured_order, display_order, latest_revision_id, latest_revision_number, published_revision_id, published_at, published_by, first_published_at, unpublished_at, version, updated_at, updated_by";
const GROUP_COLUMNS = "id, name, description, display_order, is_visible, version";
const BATCH_COLUMNS = "id, program_id, name, start_date, status";
const PUBLICATION_COLUMNS =
  "batch_id, draft_public_label, draft_registration_state, is_published, published_label, published_registration_state, first_published_at, version";

type ProgramRow = { id: string; program_code: string; name: string; status: string };
type DocRow = {
  id: string;
  kind: string;
  program_id: string | null;
  slug: string | null;
  display_group_id: string | null;
  is_featured: boolean;
  featured_order: number | null;
  display_order: number | null;
  latest_revision_id: string | null;
  latest_revision_number: number;
  published_revision_id: string | null;
  published_at: string | null;
  published_by: string | null;
  first_published_at: string | null;
  unpublished_at: string | null;
  version: number;
  updated_at: string;
  updated_by: string | null;
};
type GroupRow = {
  id: string;
  name: string;
  description: string | null;
  display_order: number;
  is_visible: boolean;
  version: number;
};
type PublicationRow = {
  batch_id: string;
  draft_public_label: string | null;
  draft_registration_state: WebsiteRegistrationState;
  is_published: boolean;
  published_label: string | null;
  published_registration_state: WebsiteRegistrationState | null;
  first_published_at: string | null;
  version: number;
};

function log(message: string, error?: unknown) {
  console.error(`[website-programs] ${message}:`, error);
}

function toProgram(row: ProgramRow): ProgramInfo {
  return {
    id: row.id,
    code: row.program_code,
    name: row.name,
    status: row.status as LmsProgramStatus,
  };
}

function toDocument(
  row: DocRow,
  title: string | null,
  groupNames: Map<string, string>,
): ProgramWebsiteDocument {
  return {
    id: row.id,
    slug: row.slug ?? "",
    status: websitePageStatus({
      latestRevisionId: row.latest_revision_id,
      publishedRevisionId: row.published_revision_id,
      firstPublishedAt: row.first_published_at,
    }),
    title,
    latestRevisionId: row.latest_revision_id,
    latestRevisionNumber: row.latest_revision_number,
    publishedRevisionId: row.published_revision_id,
    version: row.version,
    firstPublishedAt: row.first_published_at,
    publishedAt: row.published_at,
    unpublishedAt: row.unpublished_at,
    updatedAt: row.updated_at,
    placement: {
      displayGroupId: row.display_group_id,
      displayGroupName: row.display_group_id
        ? (groupNames.get(row.display_group_id) ?? null)
        : null,
      isFeatured: row.is_featured,
      featuredOrder: row.featured_order,
      displayOrder: row.display_order,
    },
  };
}

function toPublication(row: PublicationRow): BatchPublicationRow {
  return {
    draftLabel: row.draft_public_label,
    draftState: row.draft_registration_state,
    isPublished: row.is_published,
    publishedLabel: row.published_label,
    publishedState: row.published_registration_state,
    firstPublishedAt: row.first_published_at,
    version: row.version,
  };
}

async function groupNameMap(client: Client): Promise<Map<string, string>> {
  const { data, error } = await client.from("website_display_groups").select("id, name");
  if (error) throw error;
  return new Map(
    ((data ?? []) as Array<{ id: string; name: string }>).map((g) => [g.id, g.name]),
  );
}

async function revisionTitles(
  client: Client,
  ids: Array<string | null>,
): Promise<Map<string, string>> {
  const wanted = ids.filter((id): id is string => Boolean(id));
  const titles = new Map<string, string>();
  if (wanted.length === 0) return titles;
  const { data, error } = await client
    .from("website_document_revisions")
    .select("id, title")
    .in("id", wanted);
  if (error) throw error;
  for (const r of (data ?? []) as Array<{ id: string; title: string }>) {
    titles.set(r.id, r.title);
  }
  return titles;
}

// ---------------------------------------------------------------------------
// Reads

/**
 * Every LMS Program with its website entry, if any. Archived Programs are
 * listed only when they already have website content.
 */
export async function listProgramWebsiteEntries(): Promise<
  DataResult<ProgramWebsiteSummary[]>
> {
  try {
    const client = await createSupabaseServerClient();
    const [programs, docs, groups] = await Promise.all([
      client.from("programs").select(PROGRAM_COLUMNS).order("program_code"),
      client.from("website_documents").select(DOC_COLUMNS).eq("kind", "program"),
      groupNameMap(client),
    ]);
    if (programs.error) throw programs.error;
    if (docs.error) throw docs.error;
    const docRows = (docs.data ?? []) as DocRow[];
    const byProgram = new Map(docRows.map((d) => [d.program_id, d]));
    const titles = await revisionTitles(
      client,
      docRows.map((d) => d.latest_revision_id),
    );
    const entries: ProgramWebsiteSummary[] = [];
    for (const p of (programs.data ?? []) as ProgramRow[]) {
      const doc = byProgram.get(p.id) ?? null;
      if (!doc && p.status === "archived") continue;
      entries.push({
        program: toProgram(p),
        document: doc
          ? toDocument(
              doc,
              doc.latest_revision_id
                ? (titles.get(doc.latest_revision_id) ?? null)
                : null,
              groups,
            )
          : null,
      });
    }
    return { ok: true, data: entries };
  } catch (error) {
    log("Could not load Program website entries", error);
    return { ok: false, error: "Could not load the Programs." };
  }
}

/** One Program's website entry with its latest saved content. */
export async function getProgramWebsite(
  documentId: string,
): Promise<DataResult<ProgramWebsiteDetail>> {
  if (!isUuid(documentId)) return { ok: false, error: PROGRAM_WEBSITE_NOT_FOUND };
  try {
    const client = await createSupabaseServerClient();
    const { data, error } = await client
      .from("website_documents")
      .select(DOC_COLUMNS)
      .eq("id", documentId)
      .maybeSingle();
    if (error) throw error;
    const doc = data as DocRow | null;
    if (!doc || doc.kind !== "program" || !doc.program_id) {
      return { ok: false, error: PROGRAM_WEBSITE_NOT_FOUND };
    }
    const { data: programData, error: programError } = await client
      .from("programs")
      .select(PROGRAM_COLUMNS)
      .eq("id", doc.program_id)
      .maybeSingle();
    if (programError) throw programError;
    if (!programData) return { ok: false, error: PROGRAM_WEBSITE_NOT_FOUND };

    const wanted = [doc.latest_revision_id, doc.published_revision_id].filter(
      (r): r is string => Boolean(r),
    );
    let latestRow: RevisionRow | null = null;
    let publishedNumber: number | null = null;
    if (wanted.length > 0) {
      const { data: revs, error: revError } = await client
        .from("website_document_revisions")
        .select(REVISION_COLUMNS)
        .eq("document_id", doc.id)
        .in("id", wanted);
      if (revError) throw revError;
      for (const r of (revs ?? []) as RevisionRow[]) {
        if (r.id === doc.latest_revision_id) latestRow = r;
        if (r.id === doc.published_revision_id) publishedNumber = r.revision_number;
      }
    }
    const [names, groups] = await Promise.all([
      adminNames(client, [
        doc.updated_by,
        doc.published_by,
        latestRow?.created_by ?? null,
      ]),
      groupNameMap(client),
    ]);
    return {
      ok: true,
      data: {
        program: toProgram(programData as ProgramRow),
        document: {
          ...toDocument(doc, latestRow?.title ?? null, groups),
          publishedRevisionNumber: publishedNumber,
          updatedByName: doc.updated_by ? (names.get(doc.updated_by) ?? null) : null,
          publishedByName: doc.published_by
            ? (names.get(doc.published_by) ?? null)
            : null,
        },
        latest: latestRow ? toContent(latestRow, names) : null,
      },
    };
  } catch (error) {
    log("Could not load a Program's website content", error);
    return { ok: false, error: "Could not load this Program's website content." };
  }
}

/** Active display groups in display order, with how many Programs each holds. */
export async function listDisplayGroups(): Promise<DataResult<DisplayGroup[]>> {
  try {
    const client = await createSupabaseServerClient();
    const [groups, docs] = await Promise.all([
      client
        .from("website_display_groups")
        .select(GROUP_COLUMNS)
        .is("archived_at", null)
        .order("display_order"),
      client.from("website_documents").select("display_group_id").eq("kind", "program"),
    ]);
    if (groups.error) throw groups.error;
    if (docs.error) throw docs.error;
    const counts = new Map<string, number>();
    for (const d of (docs.data ?? []) as Array<{ display_group_id: string | null }>) {
      if (d.display_group_id) {
        counts.set(d.display_group_id, (counts.get(d.display_group_id) ?? 0) + 1);
      }
    }
    return {
      ok: true,
      data: ((groups.data ?? []) as GroupRow[]).map((g) => ({
        id: g.id,
        name: g.name,
        description: g.description,
        displayOrder: g.display_order,
        isVisible: g.is_visible,
        version: g.version,
        programCount: counts.get(g.id) ?? 0,
      })),
    };
  } catch (error) {
    log("Could not load display groups", error);
    return { ok: false, error: "Could not load the display groups." };
  }
}

/** A Program's Batches (newest start first) with their website publication. */
export async function listProgramBatches(
  programId: string,
): Promise<DataResult<ProgramBatch[]>> {
  if (!isUuid(programId)) return { ok: false, error: PROGRAM_WEBSITE_NOT_FOUND };
  try {
    const client = await createSupabaseServerClient();
    const { data, error } = await client
      .from("batches")
      .select(BATCH_COLUMNS)
      .eq("program_id", programId)
      .order("start_date", { ascending: false });
    if (error) throw error;
    const batches = (data ?? []) as Array<{
      id: string;
      name: string;
      start_date: string;
      status: string;
    }>;
    const publications = new Map<string, BatchPublicationRow>();
    if (batches.length > 0) {
      const { data: pubs, error: pubError } = await client
        .from("batch_website_publications")
        .select(PUBLICATION_COLUMNS)
        .in(
          "batch_id",
          batches.map((b) => b.id),
        );
      if (pubError) throw pubError;
      for (const p of (pubs ?? []) as PublicationRow[]) {
        publications.set(p.batch_id, toPublication(p));
      }
    }
    return {
      ok: true,
      data: batches.map((b) => ({
        id: b.id,
        name: b.name,
        startDate: b.start_date,
        status: b.status as LmsBatchStatus,
        publication: publications.get(b.id) ?? null,
      })),
    };
  } catch (error) {
    log("Could not load a Program's Batches", error);
    return { ok: false, error: "Could not load this Program's Batches." };
  }
}

/** Current placement and version of the given Program documents (fresh read). */
export async function getPlacementRows(
  documentIds: string[],
): Promise<DataResult<Map<string, { version: number; placement: ProgramPlacement }>>> {
  try {
    const client = await createSupabaseServerClient();
    const { data, error } = await client
      .from("website_documents")
      .select(
        "id, kind, display_group_id, is_featured, featured_order, display_order, version",
      )
      .in("id", documentIds);
    if (error) throw error;
    const rows = new Map<string, { version: number; placement: ProgramPlacement }>();
    for (const r of (data ?? []) as Array<{
      id: string;
      kind: string;
      display_group_id: string | null;
      is_featured: boolean;
      featured_order: number | null;
      display_order: number | null;
      version: number;
    }>) {
      if (r.kind !== "program") continue;
      rows.set(r.id, {
        version: r.version,
        placement: {
          displayGroupId: r.display_group_id,
          displayGroupName: null,
          isFeatured: r.is_featured,
          featuredOrder: r.featured_order,
          displayOrder: r.display_order,
        },
      });
    }
    return { ok: true, data: rows };
  } catch (error) {
    log("Could not read Program placement", error);
    return { ok: false, error: "Could not load the featured Programs." };
  }
}

// ---------------------------------------------------------------------------
// Writes (Phase 22A database functions only)

function failure<T>(error: { code?: string; message?: string }): WriteResult<T> {
  const kind = websiteErrorKind(error.code);
  if (kind === "unknown") throw error;
  return { ok: false, kind, error: programWebsiteMessage(kind, error.message) };
}

function unexpected<T>(what: string, error: unknown): WriteResult<T> {
  log(what, error);
  return { ok: false, kind: "unknown", error: programWebsiteMessage("unknown") };
}

async function rpcVersion(
  fn: string,
  args: Record<string, unknown>,
  what: string,
): Promise<WriteResult<{ version: number }>> {
  try {
    const client = await createSupabaseServerClient();
    const { data, error } = await client.rpc(fn as never, args as never);
    if (error) return failure(error);
    return { ok: true, data: { version: Number(data) } };
  } catch (error) {
    return unexpected(what, error);
  }
}

async function rpcId(
  fn: string,
  args: Record<string, unknown>,
  what: string,
): Promise<WriteResult<{ id: string }>> {
  try {
    const client = await createSupabaseServerClient();
    const { data, error } = await client.rpc(fn as never, args as never);
    if (error) return failure(error);
    if (typeof data !== "string") throw new Error(`${fn} returned no id`);
    return { ok: true, data: { id: data } };
  } catch (error) {
    return unexpected(what, error);
  }
}

export function createProgramWebsite(programId: string, slug: string) {
  return rpcId(
    "website_create_program_document",
    { p_program_id: programId, p_slug: slug },
    "Could not create Program website content",
  );
}

export function changeProgramSlug(
  documentId: string,
  expectedVersion: number,
  slug: string,
) {
  return rpcVersion(
    "website_change_program_slug",
    { p_document_id: documentId, p_expected_version: expectedVersion, p_new_slug: slug },
    "Could not change a Program slug",
  );
}

export function updateProgramPlacement(
  documentId: string,
  expectedVersion: number,
  placement: Omit<ProgramPlacement, "displayGroupName">,
) {
  return rpcVersion(
    "website_update_program_placement",
    {
      p_document_id: documentId,
      p_expected_version: expectedVersion,
      p_display_group_id: placement.displayGroupId,
      p_is_featured: placement.isFeatured,
      p_display_order: placement.displayOrder,
      p_featured_order: placement.isFeatured ? placement.featuredOrder : null,
    },
    "Could not update Program placement",
  );
}

export function createDisplayGroup(name: string, description: string | null) {
  return rpcId(
    "website_create_display_group",
    { p_name: name, p_description: description },
    "Could not create a display group",
  );
}

export function updateDisplayGroup(
  groupId: string,
  expectedVersion: number,
  input: { name: string; description: string | null; isVisible: boolean },
) {
  return rpcVersion(
    "website_update_display_group",
    {
      p_group_id: groupId,
      p_expected_version: expectedVersion,
      p_name: input.name,
      p_description: input.description,
      p_is_visible: input.isVisible,
    },
    "Could not update a display group",
  );
}

export async function reorderDisplayGroups(
  orderedIds: string[],
): Promise<WriteResult<null>> {
  try {
    const client = await createSupabaseServerClient();
    const { error } = await client.rpc("website_reorder_display_groups", {
      p_ordered_ids: orderedIds,
    });
    if (error) return failure(error);
    return { ok: true, data: null };
  } catch (error) {
    return unexpected("Could not reorder display groups", error);
  }
}

export function saveBatchPublication(
  batchId: string,
  expectedVersion: number,
  input: { publicLabel: string | null; registrationState: WebsiteRegistrationState },
) {
  return rpcVersion(
    "website_save_batch_publication",
    {
      p_batch_id: batchId,
      p_expected_version: expectedVersion,
      p_public_label: input.publicLabel,
      p_registration_state: input.registrationState,
    },
    "Could not save a Batch's website settings",
  );
}

export function publishBatch(batchId: string, expectedVersion: number) {
  return rpcVersion(
    "website_publish_batch",
    { p_batch_id: batchId, p_expected_version: expectedVersion },
    "Could not publish a Batch",
  );
}

export function unpublishBatch(batchId: string, expectedVersion: number) {
  return rpcVersion(
    "website_unpublish_batch",
    { p_batch_id: batchId, p_expected_version: expectedVersion },
    "Could not unpublish a Batch",
  );
}

/** The Batch's Program (to confirm a Batch belongs to the Program being edited). */
export async function getBatchProgramId(batchId: string): Promise<string | null> {
  if (!isUuid(batchId)) return null;
  const client = await createSupabaseServerClient();
  const { data, error } = await client
    .from("batches")
    .select("program_id")
    .eq("id", batchId)
    .maybeSingle();
  if (error) {
    log("Could not load a Batch", error);
    return null;
  }
  return (data as { program_id: string } | null)?.program_id ?? null;
}
