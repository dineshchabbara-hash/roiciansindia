import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * lib/data/website-programs.ts with the caller's RLS-scoped client mocked. The
 * database rules (role check, version checks, Program/Batch status rules,
 * slug history, audit) are proven by the Phase 22A SQL suites; these tests
 * cover mapping, privacy of the selected columns and error handling.
 */

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));

import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  changeProgramSlug,
  createDisplayGroup,
  createProgramWebsite,
  getProgramWebsite,
  listDisplayGroups,
  listProgramBatches,
  listProgramWebsiteEntries,
  publishBatch,
  reorderDisplayGroups,
  saveBatchPublication,
  unpublishBatch,
  updateDisplayGroup,
  updateProgramPlacement,
} from "@/lib/data/website-programs";
import { listWebsiteRevisions } from "@/lib/data/website";

const P1 = "11111111-0000-4000-8000-000000000001";
const P2 = "11111111-0000-4000-8000-000000000002";
const P3 = "11111111-0000-4000-8000-000000000003";
const DOC = "aaaaaaaa-0000-4000-8000-000000000001";
const G1 = "dddddddd-0000-4000-8000-000000000001";
const REV = "bbbbbbbb-0000-4000-8000-000000000001";
const B1 = "eeeeeeee-0000-4000-8000-000000000001";
const B2 = "eeeeeeee-0000-4000-8000-000000000002";
const ADMIN = "cccccccc-0000-4000-8000-000000000001";

type Result = { data?: unknown; error?: unknown };

function makeClient(options: {
  tables?: Record<string, Result[]>;
  rpc?: Record<string, Result>;
}) {
  const calls: Array<{ table: string; method: string; args: unknown[] }> = [];
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const queues: Record<string, Result[]> = Object.fromEntries(
    Object.entries(options.tables ?? {}).map(([k, v]) => [k, [...v]]),
  );
  const client = {
    from(table: string) {
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "eq", "neq", "in", "is", "order", "maybeSingle"]) {
        builder[method] = (...args: unknown[]) => {
          calls.push({ table, method, args });
          return builder;
        };
      }
      builder.then = (
        resolve: (v: unknown) => unknown,
        reject: (e: unknown) => unknown,
      ) =>
        Promise.resolve({
          data: null,
          error: null,
          ...(queues[table]?.shift() ?? {}),
        }).then(resolve, reject);
      return builder;
    },
    rpc(fn: string, args: Record<string, unknown>) {
      rpcCalls.push({ fn, args });
      return Promise.resolve({ data: null, error: null, ...(options.rpc?.[fn] ?? {}) });
    },
  };
  vi.mocked(createSupabaseServerClient).mockResolvedValue(client as never);
  return { calls, rpcCalls };
}

function programDoc(overrides: Record<string, unknown> = {}) {
  return {
    id: DOC,
    kind: "program",
    program_id: P1,
    slug: "software-testing",
    display_group_id: G1,
    is_featured: true,
    featured_order: 2,
    display_order: 5,
    latest_revision_id: REV,
    latest_revision_number: 1,
    published_revision_id: null,
    published_at: null,
    published_by: null,
    first_published_at: null,
    unpublished_at: null,
    version: 3,
    updated_at: "2026-10-23T10:00:00Z",
    updated_by: ADMIN,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("security boundary", () => {
  // Code only: the module's comments describe what is NOT read.
  const source = readFileSync(
    path.resolve(import.meta.dirname, "../website-programs.ts"),
    "utf8",
  )
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  it("never imports the service-role client", () => {
    expect(source).not.toMatch(/service-role|createSupabaseAdminClient|SERVICE_ROLE/i);
  });

  it("never selects fees, capacity, links, locations or notes", () => {
    for (const column of [
      "regular_fee",
      "registration_fee",
      "tax_rate_percent",
      "capacity",
      "meeting_link",
      "location",
      "notes",
      "description, category",
    ]) {
      expect(source).not.toContain(column);
    }
  });
});

describe("listProgramWebsiteEntries", () => {
  it("joins LMS Programs with their website entries and group names", async () => {
    const { calls } = makeClient({
      tables: {
        programs: [
          {
            data: [
              {
                id: P1,
                program_code: "ST-01",
                name: "Software Testing",
                status: "active",
              },
              { id: P2, program_code: "DA-01", name: "Data Analytics", status: "draft" },
              { id: P3, program_code: "OLD-01", name: "Old Program", status: "archived" },
            ],
          },
        ],
        website_documents: [{ data: [programDoc()] }],
        website_display_groups: [{ data: [{ id: G1, name: "Quality Engineering" }] }],
        website_document_revisions: [
          { data: [{ id: REV, title: "Software Testing Pro" }] },
        ],
      },
    });
    const result = await listProgramWebsiteEntries();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The archived Program without website content is left out.
    expect(result.data.map((e) => e.program.code)).toEqual(["ST-01", "DA-01"]);
    expect(result.data[0].document).toMatchObject({
      id: DOC,
      slug: "software-testing",
      status: "draft",
      title: "Software Testing Pro",
      placement: {
        displayGroupId: G1,
        displayGroupName: "Quality Engineering",
        isFeatured: true,
        featuredOrder: 2,
        displayOrder: 5,
      },
    });
    expect(result.data[1].document).toBeNull();
    expect(calls).toContainEqual({
      table: "programs",
      method: "select",
      args: ["id, program_code, name, status"],
    });
    expect(calls).toContainEqual({
      table: "website_documents",
      method: "eq",
      args: ["kind", "program"],
    });
  });

  it("keeps an archived Program that already has website content", async () => {
    makeClient({
      tables: {
        programs: [
          { data: [{ id: P1, program_code: "OLD", name: "Old", status: "archived" }] },
        ],
        website_documents: [{ data: [programDoc({ latest_revision_id: null })] }],
        website_display_groups: [{ data: [] }],
      },
    });
    const result = await listProgramWebsiteEntries();
    expect(result.ok && result.data).toHaveLength(1);
  });

  it("reports a load failure without detail", async () => {
    makeClient({ tables: { programs: [{ error: { message: "boom" } }] } });
    expect(await listProgramWebsiteEntries()).toEqual({
      ok: false,
      error: "Could not load the Programs.",
    });
  });
});

describe("getProgramWebsite", () => {
  it("refuses a malformed id without querying", async () => {
    const { calls } = makeClient({});
    expect((await getProgramWebsite("nope")).ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("treats a website page (not a Program) as not found", async () => {
    makeClient({
      tables: { website_documents: [{ data: programDoc({ kind: "home" }) }] },
    });
    expect(await getProgramWebsite(DOC)).toEqual({
      ok: false,
      error: "This Program's website content could not be found.",
    });
  });

  it("returns the Program, placement and latest content", async () => {
    makeClient({
      tables: {
        website_documents: [{ data: programDoc() }],
        programs: [
          {
            data: {
              id: P1,
              program_code: "ST-01",
              name: "Software Testing",
              status: "active",
            },
          },
        ],
        website_document_revisions: [
          {
            data: [
              {
                id: REV,
                document_id: DOC,
                revision_number: 1,
                title: "Software Testing Pro",
                summary: "Hands-on testing.",
                seo_title: null,
                seo_description: null,
                social_title: null,
                social_description: null,
                hero_image_asset_id: null,
                social_image_asset_id: null,
                sections: [],
                restored_from_revision_id: null,
                created_at: "2026-10-23T10:00:00Z",
                created_by: ADMIN,
              },
            ],
          },
        ],
        admins: [
          { data: [{ auth_user_id: ADMIN, first_name: "Asha", last_name: "Rao" }] },
        ],
        website_display_groups: [{ data: [{ id: G1, name: "Quality Engineering" }] }],
      },
    });
    const result = await getProgramWebsite(DOC);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.program).toEqual({
      id: P1,
      code: "ST-01",
      name: "Software Testing",
      status: "active",
    });
    expect(result.data.document.updatedByName).toBe("Asha Rao");
    expect(result.data.document.placement.displayGroupName).toBe("Quality Engineering");
    expect(result.data.latest?.title).toBe("Software Testing Pro");
  });
});

describe("listDisplayGroups", () => {
  it("lists active groups in order with their Program counts", async () => {
    const { calls } = makeClient({
      tables: {
        website_display_groups: [
          {
            data: [
              {
                id: G1,
                name: "Quality Engineering",
                description: null,
                display_order: 1,
                is_visible: false,
                version: 4,
              },
            ],
          },
        ],
        website_documents: [
          { data: [{ display_group_id: G1 }, { display_group_id: null }] },
        ],
      },
    });
    const result = await listDisplayGroups();
    expect(result.ok && result.data).toEqual([
      {
        id: G1,
        name: "Quality Engineering",
        description: null,
        displayOrder: 1,
        isVisible: false,
        version: 4,
        programCount: 1,
      },
    ]);
    expect(calls).toContainEqual({
      table: "website_display_groups",
      method: "is",
      args: ["archived_at", null],
    });
  });
});

describe("listProgramBatches", () => {
  it("returns Batches with their publication, and only safe columns", async () => {
    const { calls } = makeClient({
      tables: {
        batches: [
          {
            data: [
              {
                id: B1,
                program_id: P1,
                name: "ST Mar Wknd",
                start_date: "2027-03-06",
                status: "upcoming",
              },
              {
                id: B2,
                program_id: P1,
                name: "ST Jan",
                start_date: "2027-01-10",
                status: "completed",
              },
            ],
          },
        ],
        batch_website_publications: [
          {
            data: [
              {
                batch_id: B1,
                draft_public_label: "Weekend batch",
                draft_registration_state: "open",
                is_published: true,
                published_label: "Weekend batch",
                published_registration_state: "open",
                first_published_at: "2026-10-23T10:00:00Z",
                version: 2,
              },
            ],
          },
        ],
      },
    });
    const result = await listProgramBatches(P1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data[0].publication).toMatchObject({
      draftLabel: "Weekend batch",
      isPublished: true,
      version: 2,
    });
    expect(result.data[1].publication).toBeNull();
    expect(calls).toContainEqual({
      table: "batches",
      method: "select",
      args: ["id, program_id, name, start_date, status"],
    });
  });
});

describe("writes go through the 22A functions", () => {
  it("creates Program website content", async () => {
    const { rpcCalls } = makeClient({
      rpc: { website_create_program_document: { data: DOC } },
    });
    expect(await createProgramWebsite(P1, "software-testing")).toEqual({
      ok: true,
      data: { id: DOC },
    });
    expect(rpcCalls[0]).toEqual({
      fn: "website_create_program_document",
      args: { p_program_id: P1, p_slug: "software-testing" },
    });
  });

  it("shows the database's own slug message", async () => {
    makeClient({
      rpc: {
        website_create_program_document: {
          error: {
            code: "P2205",
            message: "That Program already has website content, or the slug is taken",
          },
        },
      },
    });
    expect(await createProgramWebsite(P1, "taken")).toEqual({
      ok: false,
      kind: "slug_unavailable",
      error: "That Program already has website content, or the slug is taken.",
    });
  });

  it("changes a slug with the expected version", async () => {
    const { rpcCalls } = makeClient({
      rpc: { website_change_program_slug: { data: 4 } },
    });
    expect(await changeProgramSlug(DOC, 3, "new-slug")).toEqual({
      ok: true,
      data: { version: 4 },
    });
    expect(rpcCalls[0].args).toEqual({
      p_document_id: DOC,
      p_expected_version: 3,
      p_new_slug: "new-slug",
    });
  });

  it("updates placement, sending no featured order when not featured", async () => {
    const { rpcCalls } = makeClient({
      rpc: { website_update_program_placement: { data: 4 } },
    });
    await updateProgramPlacement(DOC, 3, {
      displayGroupId: G1,
      isFeatured: false,
      displayOrder: 2,
      featuredOrder: 7,
    });
    expect(rpcCalls[0].args).toEqual({
      p_document_id: DOC,
      p_expected_version: 3,
      p_display_group_id: G1,
      p_is_featured: false,
      p_display_order: 2,
      p_featured_order: null,
    });
  });

  it("reports a stale placement change", async () => {
    makeClient({
      rpc: {
        website_update_program_placement: { error: { code: "P2203", message: "x" } },
      },
    });
    const result = await updateProgramPlacement(DOC, 1, {
      displayGroupId: null,
      isFeatured: true,
      displayOrder: null,
      featuredOrder: 1,
    });
    expect(result).toMatchObject({ ok: false, kind: "stale" });
  });

  it("manages display groups", async () => {
    const { rpcCalls } = makeClient({
      rpc: {
        website_create_display_group: { data: G1 },
        website_update_display_group: { data: 2 },
        website_reorder_display_groups: { data: null },
      },
    });
    expect(await createDisplayGroup("Data & AI", null)).toEqual({
      ok: true,
      data: { id: G1 },
    });
    expect(
      await updateDisplayGroup(G1, 1, {
        name: "Data and AI",
        description: null,
        isVisible: false,
      }),
    ).toEqual({ ok: true, data: { version: 2 } });
    expect(await reorderDisplayGroups([G1])).toEqual({ ok: true, data: null });
    expect(rpcCalls.map((c) => c.fn)).toEqual([
      "website_create_display_group",
      "website_update_display_group",
      "website_reorder_display_groups",
    ]);
    expect(rpcCalls[1].args).toEqual({
      p_group_id: G1,
      p_expected_version: 1,
      p_name: "Data and AI",
      p_description: null,
      p_is_visible: false,
    });
  });

  it("shows a duplicate group name plainly", async () => {
    makeClient({
      rpc: {
        website_create_display_group: {
          error: {
            code: "23505",
            message: "A display group with that name already exists",
          },
        },
      },
    });
    expect(await createDisplayGroup("Data", null)).toMatchObject({
      ok: false,
      kind: "duplicate",
      error: "A display group with that name already exists.",
    });
  });

  it("saves, publishes and unpublishes a Batch's website settings", async () => {
    const { rpcCalls } = makeClient({
      rpc: {
        website_save_batch_publication: { data: 1 },
        website_publish_batch: { data: 2 },
        website_unpublish_batch: { data: 3 },
      },
    });
    await saveBatchPublication(B1, 0, {
      publicLabel: "Weekend batch",
      registrationState: "open",
    });
    await publishBatch(B1, 1);
    await unpublishBatch(B1, 2);
    expect(rpcCalls).toEqual([
      {
        fn: "website_save_batch_publication",
        args: {
          p_batch_id: B1,
          p_expected_version: 0,
          p_public_label: "Weekend batch",
          p_registration_state: "open",
        },
      },
      { fn: "website_publish_batch", args: { p_batch_id: B1, p_expected_version: 1 } },
      { fn: "website_unpublish_batch", args: { p_batch_id: B1, p_expected_version: 2 } },
    ]);
  });

  it("shows the database's reason a Batch cannot be published", async () => {
    makeClient({
      rpc: {
        website_publish_batch: {
          error: {
            code: "P2206",
            message: "Only an upcoming or active Batch can be published on the website",
          },
        },
      },
    });
    expect(await publishBatch(B1, 1)).toMatchObject({
      ok: false,
      kind: "invalid_state",
      error: "Only an upcoming or active Batch can be published on the website.",
    });
  });

  it("hides unexpected database errors", async () => {
    makeClient({
      rpc: { website_publish_batch: { error: { code: "XX000", message: "secret" } } },
    });
    expect(await publishBatch(B1, 1)).toEqual({
      ok: false,
      kind: "unknown",
      error: "Something went wrong. Please try again.",
    });
  });
});

describe("22B-1 history readers with the Program scope", () => {
  it("lists a Program's versions only when asked for the Program scope", async () => {
    makeClient({
      tables: {
        website_documents: [{ data: programDoc() }, { data: programDoc() }],
        website_document_revisions: [
          {
            data: [
              {
                id: REV,
                revision_number: 1,
                title: "Software Testing Pro",
                created_at: "2026-10-23T10:00:00Z",
                created_by: null,
                restored_from_revision_id: null,
              },
            ],
          },
        ],
      },
    });
    // Default scope (website pages) still refuses a Program document.
    expect((await listWebsiteRevisions(DOC)).ok).toBe(false);
    const result = await listWebsiteRevisions(DOC, "program");
    expect(result.ok && result.data.map((r) => r.number)).toEqual([1]);
  });
});
