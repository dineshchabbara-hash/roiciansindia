import { createClient } from "@supabase/supabase-js";
import { RUN_ID, isIsolatedLocalSupabase } from "./phase22b-fixtures";

/**
 * Node-side setup for the Phase 22B-2 Program Website Management E2E suite
 * (e2e/phase22b2-program-website.spec.ts).
 *
 * ISOLATED ONLY, exactly like phase22b-fixtures.ts: these helpers refuse to
 * run unless PHASE22B_E2E_ISOLATED=1 and the Supabase URL is a local,
 * disposable stack (127.0.0.1 or localhost). They create clearly synthetic
 * Programs and Batches in that throwaway database only. They never touch
 * DEV or production, and never publish anything outside the test stack.
 */

export { RUN_ID, isIsolatedLocalSupabase };

function serviceClient() {
  if (!isIsolatedLocalSupabase()) {
    throw new Error(
      "Refusing to touch a database: Phase 22B E2E runs only against a local, disposable Supabase stack.",
    );
  }
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

export type TestProgram = { id: string; code: string; name: string };

/** A synthetic LMS Program (local test stack only). */
export async function createProgram(
  tag: string,
  status: "draft" | "active" | "inactive",
): Promise<TestProgram> {
  const code = `E2E-${tag}-${RUN_ID}`.toUpperCase();
  const name = `E2E Program ${tag} ${RUN_ID}`;
  const { data, error } = await serviceClient()
    .from("programs")
    .insert({ program_code: code, name, status, regular_fee: 1000 })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Could not create Program: ${error?.message}`);
  return { id: (data as { id: string }).id, code, name };
}

export type TestBatch = { id: string; name: string };

/** A synthetic Batch of a Program (local test stack only). */
export async function createBatch(
  programId: string,
  tag: string,
  status: "upcoming" | "active" | "completed",
  startDate: string,
): Promise<TestBatch> {
  const name = `E2E-BATCH-${tag}-${RUN_ID}`;
  const { data, error } = await serviceClient()
    .from("batches")
    .insert({ program_id: programId, name, start_date: startDate, status })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Could not create Batch: ${error?.message}`);
  return { id: (data as { id: string }).id, name };
}

/** The LMS Program row (to prove website work never changes it). */
export async function readProgram(programId: string) {
  const { data, error } = await serviceClient()
    .from("programs")
    .select("program_code, name, status, regular_fee, registration_fee, description")
    .eq("id", programId)
    .single();
  if (error) throw new Error(`Could not read Program: ${error.message}`);
  return data;
}

export type ProgramDocumentState = {
  id: string;
  slug: string;
  displayGroupId: string | null;
  isFeatured: boolean;
  featuredOrder: number | null;
  latestRevisionNumber: number;
  publishedRevisionId: string | null;
  latestRevisionId: string | null;
  firstPublishedAt: string | null;
};

/** A Program's website document (verification only). */
export async function readProgramDocument(
  programId: string,
): Promise<ProgramDocumentState | null> {
  const { data, error } = await serviceClient()
    .from("website_documents")
    .select(
      "id, slug, display_group_id, is_featured, featured_order, latest_revision_number, published_revision_id, latest_revision_id, first_published_at",
    )
    .eq("program_id", programId)
    .maybeSingle();
  if (error) throw new Error(`Could not read Program document: ${error.message}`);
  if (!data) return null;
  const r = data as Record<string, unknown>;
  return {
    id: r.id as string,
    slug: r.slug as string,
    displayGroupId: (r.display_group_id as string | null) ?? null,
    isFeatured: r.is_featured as boolean,
    featuredOrder: (r.featured_order as number | null) ?? null,
    latestRevisionNumber: r.latest_revision_number as number,
    publishedRevisionId: (r.published_revision_id as string | null) ?? null,
    latestRevisionId: (r.latest_revision_id as string | null) ?? null,
    firstPublishedAt: (r.first_published_at as string | null) ?? null,
  };
}

/** Active display groups with the given names, in display order. */
export async function readDisplayGroups(names: string[]) {
  const { data, error } = await serviceClient()
    .from("website_display_groups")
    .select("id, name, display_order, is_visible")
    .in("name", names)
    .is("archived_at", null)
    .order("display_order");
  if (error) throw new Error(`Could not read display groups: ${error.message}`);
  return (data ?? []) as Array<{
    id: string;
    name: string;
    display_order: number;
    is_visible: boolean;
  }>;
}

export async function readBatchPublication(batchId: string) {
  const { data, error } = await serviceClient()
    .from("batch_website_publications")
    .select(
      "draft_public_label, draft_registration_state, is_published, published_label, published_registration_state",
    )
    .eq("batch_id", batchId)
    .maybeSingle();
  if (error) throw new Error(`Could not read Batch publication: ${error.message}`);
  return data as {
    draft_public_label: string | null;
    draft_registration_state: string;
    is_published: boolean;
    published_label: string | null;
    published_registration_state: string | null;
  } | null;
}

/** Audit actions recorded for an entity (Program document, group or Batch). */
export async function readAuditActions(entityId: string): Promise<string[]> {
  const { data, error } = await serviceClient()
    .from("audit_logs")
    .select("action, created_at")
    .eq("entity_id", entityId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Could not read audit log: ${error.message}`);
  return ((data ?? []) as Array<{ action: string }>).map((r) => r.action);
}
