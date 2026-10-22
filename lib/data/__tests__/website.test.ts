import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * lib/data/website.ts with the caller's RLS-scoped client mocked. The database
 * rules (role check, stale-edit guard, content validation, audit) are proven
 * by supabase/tests/phase22a_website_foundation_test.sql and
 * phase22a_corrections_test.sql; these tests cover mapping and error handling.
 */

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));

import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  createWebsitePage,
  getWebsitePage,
  getWebsiteRevision,
  listWebsitePages,
  listWebsiteRevisions,
  parseStoredSections,
  publishWebsitePage,
  restoreWebsiteRevision,
  saveWebsiteDraft,
  unpublishWebsitePage,
} from "@/lib/data/website";

const DOC = "aaaaaaaa-0000-4000-8000-000000000001";
const REV1 = "bbbbbbbb-0000-4000-8000-000000000001";
const REV2 = "bbbbbbbb-0000-4000-8000-000000000002";
const ADMIN_A = "cccccccc-0000-4000-8000-000000000001";
const ADMIN_B = "cccccccc-0000-4000-8000-000000000002";

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
      for (const method of ["select", "eq", "neq", "in", "order", "maybeSingle"]) {
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

function docRow(overrides: Record<string, unknown> = {}) {
  return {
    id: DOC,
    kind: "home",
    page_key: "home",
    latest_revision_id: REV2,
    latest_revision_number: 2,
    published_revision_id: REV1,
    published_at: "2026-10-20T10:00:00Z",
    published_by: ADMIN_B,
    first_published_at: "2026-10-20T10:00:00Z",
    unpublished_at: null,
    version: 5,
    updated_at: "2026-10-21T10:00:00Z",
    updated_by: ADMIN_A,
    ...overrides,
  };
}

function revisionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: REV2,
    document_id: DOC,
    revision_number: 2,
    title: "Practical technology training",
    summary: null,
    seo_title: null,
    seo_description: null,
    social_title: null,
    social_description: null,
    hero_image_asset_id: null,
    social_image_asset_id: null,
    sections: [{ key: "intro", type: "text", visible: true, body: "Hello" }],
    restored_from_revision_id: null,
    created_at: "2026-10-21T10:00:00Z",
    created_by: ADMIN_A,
    ...overrides,
  };
}

const NAMES = {
  data: [
    { auth_user_id: ADMIN_A, first_name: "Asha", last_name: "Rao" },
    { auth_user_id: ADMIN_B, first_name: "Ravi", last_name: "Iyer" },
  ],
};

beforeEach(() => vi.clearAllMocks());

describe("security boundary", () => {
  it("never imports the service-role client", () => {
    const source = readFileSync(path.resolve(__dirname, "../website.ts"), "utf8");
    expect(source).not.toMatch(/supabase\/admin|createSupabaseAdminClient|SERVICE_ROLE/);
    expect(source).not.toMatch(
      /\.from\("website_documents"\)\s*\.(insert|update|delete|upsert)/,
    );
  });
});

describe("listWebsitePages", () => {
  it("lists non-Program pages with status, latest title and names", async () => {
    const { calls } = makeClient({
      tables: {
        website_documents: [
          {
            data: [
              docRow(),
              docRow({ id: "x", kind: "program", page_key: "program-1" }),
              docRow({
                id: "y",
                kind: "legal",
                page_key: "privacy-policy",
                latest_revision_id: null,
                latest_revision_number: 0,
                published_revision_id: null,
                published_by: null,
                first_published_at: null,
                published_at: null,
              }),
            ],
          },
        ],
        website_document_revisions: [{ data: [{ id: REV2, title: "Home title" }] }],
        admins: [NAMES],
      },
    });
    const result = await listWebsitePages();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.map((p) => p.kind)).toEqual(["home", "legal"]);
    expect(result.data[0]).toMatchObject({
      title: "Home title",
      status: "published_with_changes",
      updatedByName: "Asha Rao",
      publishedByName: "Ravi Iyer",
      version: 5,
    });
    expect(result.data[1]).toMatchObject({ status: "empty", title: null });
    expect(calls).toContainEqual({
      table: "website_documents",
      method: "neq",
      args: ["kind", "program"],
    });
  });

  it("reports a load failure without detail", async () => {
    makeClient({
      tables: { website_documents: [{ error: { code: "XX000", message: "secret" } }] },
    });
    expect(await listWebsitePages()).toEqual({
      ok: false,
      error: "Could not load website pages.",
    });
  });
});

describe("getWebsitePage", () => {
  it("refuses a malformed id without querying", async () => {
    const { calls } = makeClient({});
    expect(await getWebsitePage("not-a-uuid")).toEqual({
      ok: false,
      error: "This page could not be found.",
    });
    expect(calls).toHaveLength(0);
  });

  it("returns the latest version and the published version number", async () => {
    makeClient({
      tables: {
        website_documents: [{ data: docRow() }],
        website_document_revisions: [
          {
            data: [
              revisionRow(),
              revisionRow({ id: REV1, revision_number: 1, title: "Old" }),
            ],
          },
        ],
        admins: [NAMES],
      },
    });
    const result = await getWebsitePage(DOC);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.latest).toMatchObject({
      id: REV2,
      number: 2,
      title: "Practical technology training",
      createdByName: "Asha Rao",
      sections: [{ key: "intro", type: "text", visible: true, body: "Hello" }],
    });
    expect(result.data.publishedRevisionNumber).toBe(1);
  });

  it("treats a Program page as not found (22B-2)", async () => {
    makeClient({
      tables: { website_documents: [{ data: docRow({ kind: "program" }) }] },
    });
    const result = await getWebsitePage(DOC);
    expect(result.ok).toBe(false);
  });
});

describe("listWebsiteRevisions", () => {
  it("marks the latest and published versions and restore sources", async () => {
    makeClient({
      tables: {
        website_documents: [{ data: docRow() }],
        website_document_revisions: [
          {
            data: [
              {
                id: "r3",
                revision_number: 3,
                title: "T3",
                created_at: "c",
                created_by: ADMIN_A,
                restored_from_revision_id: REV1,
              },
              {
                id: REV2,
                revision_number: 2,
                title: "T2",
                created_at: "c",
                created_by: ADMIN_B,
                restored_from_revision_id: null,
              },
              {
                id: REV1,
                revision_number: 1,
                title: "T1",
                created_at: "c",
                created_by: null,
                restored_from_revision_id: null,
              },
            ],
          },
        ],
        admins: [NAMES],
      },
    });
    const result = await listWebsiteRevisions(DOC);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data[0]).toMatchObject({
      number: 3,
      restoredFromNumber: 1,
      isLatest: false,
    });
    expect(result.data[1]).toMatchObject({
      number: 2,
      isLatest: true,
      isPublished: false,
    });
    expect(result.data[2]).toMatchObject({
      number: 1,
      isPublished: true,
      createdByName: null,
    });
  });
});

describe("getWebsiteRevision", () => {
  it("only returns a revision of the same page", async () => {
    const { calls } = makeClient({
      tables: {
        website_documents: [{ data: docRow() }],
        website_document_revisions: [{ data: null }],
      },
    });
    expect((await getWebsiteRevision(DOC, REV1)).ok).toBe(false);
    expect(calls).toContainEqual({
      table: "website_document_revisions",
      method: "eq",
      args: ["document_id", DOC],
    });
  });
});

describe("parseStoredSections", () => {
  it("keeps known fields and drops anything malformed", () => {
    expect(
      parseStoredSections([
        {
          key: "faq",
          type: "faq",
          visible: false,
          items: [{ question: "Q", junk: 1 }, "bad"],
        },
        { type: "text" },
        null,
        { key: "cta", type: "cta", cta: { label: "Go", href: "/x" }, script: "<x>" },
      ]),
    ).toEqual([
      { key: "faq", type: "faq", visible: false, items: [{ question: "Q" }] },
      { key: "cta", type: "cta", visible: true, cta: { label: "Go", href: "/x" } },
    ]);
    expect(parseStoredSections("nope")).toEqual([]);
  });
});

describe("writes go through the 22A functions", () => {
  it("creates a page", async () => {
    const { rpcCalls } = makeClient({ rpc: { website_create_page: { data: DOC } } });
    expect(await createWebsitePage("about", "about")).toEqual({
      ok: true,
      data: { id: DOC },
    });
    expect(rpcCalls).toEqual([
      { fn: "website_create_page", args: { p_kind: "about", p_page_key: "about" } },
    ]);
  });

  it("reports an existing page plainly", async () => {
    makeClient({
      rpc: {
        website_create_page: {
          error: { code: "23505", message: "That page already exists" },
        },
      },
    });
    expect(await createWebsitePage("about", "about")).toEqual({
      ok: false,
      kind: "duplicate",
      error: "That page already exists.",
    });
  });

  it("saves a draft with the base revision number", async () => {
    const { rpcCalls } = makeClient({
      rpc: { website_save_draft: { data: [{ revision_id: REV2, revision_number: 2 }] } },
    });
    const result = await saveWebsiteDraft({
      documentId: DOC,
      baseRevisionNumber: 1,
      title: "T",
      summary: null,
      seoTitle: null,
      seoDescription: null,
      socialTitle: null,
      socialDescription: null,
      heroImageAssetId: null,
      socialImageAssetId: null,
      sections: [],
    });
    expect(result).toEqual({ ok: true, data: { revisionId: REV2, revisionNumber: 2 } });
    expect(rpcCalls[0].args).toMatchObject({
      p_document_id: DOC,
      p_base_revision_number: 1,
      p_title: "T",
    });
  });

  it("recognises a stale save", async () => {
    makeClient({
      rpc: { website_save_draft: { error: { code: "P2203", message: "newer" } } },
    });
    const result = await saveWebsiteDraft({
      documentId: DOC,
      baseRevisionNumber: 0,
      title: "T",
      summary: null,
      seoTitle: null,
      seoDescription: null,
      socialTitle: null,
      socialDescription: null,
      heroImageAssetId: null,
      socialImageAssetId: null,
      sections: [],
    });
    expect(result).toMatchObject({ ok: false, kind: "stale" });
  });

  it("maps a refused session to not_allowed", async () => {
    makeClient({
      rpc: { website_publish_document: { error: { code: "42501", message: "x" } } },
    });
    expect(await publishWebsitePage(DOC, REV2)).toMatchObject({
      ok: false,
      kind: "not_allowed",
    });
  });

  it("hides unexpected database errors", async () => {
    makeClient({
      rpc: {
        website_publish_document: {
          error: { code: "XX000", message: "internal detail" },
        },
      },
    });
    expect(await publishWebsitePage(DOC, REV2)).toEqual({
      ok: false,
      kind: "unknown",
      error: "Something went wrong. Please try again.",
    });
  });

  it("unpublishes with the expected version", async () => {
    const { rpcCalls } = makeClient({ rpc: { website_unpublish_document: { data: 6 } } });
    expect(await unpublishWebsitePage(DOC, 5)).toEqual({
      ok: true,
      data: { version: 6 },
    });
    expect(rpcCalls[0].args).toEqual({ p_document_id: DOC, p_expected_version: 5 });
  });

  it("restores a version as a new draft", async () => {
    const { rpcCalls } = makeClient({
      rpc: {
        website_restore_revision: { data: [{ revision_id: "r3", revision_number: 3 }] },
      },
    });
    expect(await restoreWebsiteRevision(DOC, REV1, 2)).toEqual({
      ok: true,
      data: { revisionId: "r3", revisionNumber: 3 },
    });
    expect(rpcCalls[0].args).toEqual({
      p_document_id: DOC,
      p_source_revision_id: REV1,
      p_base_revision_number: 2,
    });
  });
});
