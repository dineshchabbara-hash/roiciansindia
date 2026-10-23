import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * lib/data/website-media.ts with the caller's own (RLS-scoped) Supabase client
 * mocked, including Storage. The database and Storage rules themselves are
 * covered by the Phase 22A SQL suite and the reviewed upload proposal's SQL
 * suite; these tests cover mapping, error handling and privacy.
 */

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));

import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  createMediaUploadUrl,
  getMediaAsset,
  getMediaOptions,
  listIncompleteUploads,
  listMediaAssets,
  readStoredMedia,
  registerMediaAsset,
  removeStoredMedia,
  updateMediaAsset,
} from "@/lib/data/website-media";
import { UPLOADS_NOT_ENABLED_MESSAGE } from "@/lib/domain/website-media";

const A1 = "aaaaaaaa-0000-4000-8000-000000000001";
const A2 = "aaaaaaaa-0000-4000-8000-000000000002";
const DOC = "dddddddd-0000-4000-8000-000000000001";
const DOC2 = "dddddddd-0000-4000-8000-000000000002";
const PROG = "11111111-0000-4000-8000-000000000001";
const R1 = "bbbbbbbb-0000-4000-8000-000000000001";
const R2 = "bbbbbbbb-0000-4000-8000-000000000002";
const ADMIN = "cccccccc-0000-4000-8000-000000000001";
const PATH = "0f0e0d0c-0b0a-4908-8706-050403020100/hero.png";

type Result = { data?: unknown; error?: unknown };

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: A1,
    storage_path: PATH,
    mime_type: "image/png",
    byte_size: 20480,
    width: 1600,
    height: 900,
    alt_text: "Learners in a classroom",
    status: "approved",
    approved_at: "2026-10-23T10:00:00Z",
    approved_by: ADMIN,
    version: 3,
    created_at: "2026-10-22T10:00:00Z",
    created_by: ADMIN,
    updated_at: "2026-10-23T10:00:00Z",
    ...overrides,
  };
}

function makeClient(options: {
  tables?: Record<string, Result[]>;
  rpc?: Record<string, Result>;
  storage?: Partial<
    Record<"createSignedUrls" | "createSignedUploadUrl" | "download" | "remove", Result>
  >;
}) {
  const calls: Array<{ table: string; method: string; args: unknown[] }> = [];
  const rpcCalls: Array<{ fn: string; args: unknown }> = [];
  const storageCalls: Array<{ bucket: string; method: string; args: unknown[] }> = [];
  const queues: Record<string, Result[]> = Object.fromEntries(
    Object.entries(options.tables ?? {}).map(([k, v]) => [k, [...v]]),
  );
  const client = {
    from(table: string) {
      const builder: Record<string, unknown> = {};
      for (const method of [
        "select",
        "eq",
        "in",
        "is",
        "not",
        "order",
        "limit",
        "maybeSingle",
      ]) {
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
    rpc(fn: string, args: unknown) {
      rpcCalls.push({ fn, args });
      return Promise.resolve({ data: null, error: null, ...(options.rpc?.[fn] ?? {}) });
    },
    storage: {
      from(bucket: string) {
        const op =
          (method: keyof NonNullable<typeof options.storage>) =>
          (...args: unknown[]) => {
            storageCalls.push({ bucket, method, args });
            return Promise.resolve({
              data: null,
              error: null,
              ...(options.storage?.[method] ?? {}),
            });
          };
        return {
          createSignedUrls: op("createSignedUrls"),
          createSignedUploadUrl: op("createSignedUploadUrl"),
          download: op("download"),
          remove: op("remove"),
        };
      },
    },
  };
  vi.mocked(createSupabaseServerClient).mockResolvedValue(client as never);
  return { calls, rpcCalls, storageCalls };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("listMediaAssets", () => {
  it("maps rows, names the people involved and adds short-lived preview links", async () => {
    const { calls, storageCalls } = makeClient({
      tables: {
        website_media_assets: [{ data: [row()] }],
        admins: [
          { data: [{ auth_user_id: ADMIN, first_name: "Asha", last_name: "Rao" }] },
        ],
      },
      storage: {
        createSignedUrls: { data: [{ path: PATH, signedUrl: "https://signed/1" }] },
      },
    });
    const result = await listMediaAssets("approved");
    expect(result.ok && result.data).toEqual([
      expect.objectContaining({
        id: A1,
        fileName: "hero.png",
        mimeType: "image/png",
        status: "approved",
        createdByName: "Asha Rao",
        approvedByName: "Asha Rao",
        previewUrl: "https://signed/1",
      }),
    ]);
    expect(calls).toContainEqual({
      table: "website_media_assets",
      method: "eq",
      args: ["status", "approved"],
    });
    expect(storageCalls).toEqual([
      { bucket: "website-media", method: "createSignedUrls", args: [[PATH], 600] },
    ]);
  });

  it("still lists images when preview links cannot be made", async () => {
    makeClient({
      tables: { website_media_assets: [{ data: [row()] }], admins: [{ data: [] }] },
      storage: { createSignedUrls: { error: { message: "boom" } } },
    });
    const result = await listMediaAssets();
    expect(result.ok && result.data[0].previewUrl).toBeNull();
  });

  it("reports a read failure plainly", async () => {
    makeClient({ tables: { website_media_assets: [{ error: { message: "boom" } }] } });
    expect(await listMediaAssets()).toEqual({
      ok: false,
      error: "Could not load the media library.",
    });
  });
});

describe("getMediaOptions", () => {
  it("ignores anything that is not an id and returns chosen images by id", async () => {
    expect(await getMediaOptions(["not-an-id"])).toEqual({ ok: true, data: {} });
    makeClient({
      tables: {
        website_media_assets: [{ data: [row({ id: A2, status: "draft" })] }],
        admins: [{ data: [] }],
      },
      storage: {
        createSignedUrls: { data: [{ path: PATH, signedUrl: "https://signed/2" }] },
      },
    });
    const result = await getMediaOptions([A2, A2]);
    expect(result.ok && result.data[A2]).toMatchObject({
      status: "draft",
      previewUrl: "https://signed/2",
    });
  });
});

describe("getMediaAsset", () => {
  it("refuses a malformed id without a query", async () => {
    expect(await getMediaAsset("x")).toEqual({
      ok: false,
      error: "This image could not be found.",
    });
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
  });

  it("lists where the image is used, marking live and latest versions", async () => {
    makeClient({
      tables: {
        website_media_assets: [{ data: row() }],
        admins: [{ data: [] }],
        website_revision_media: [{ data: [{ revision_id: R1 }, { revision_id: R2 }] }],
        website_document_revisions: [
          {
            data: [
              { id: R1, document_id: DOC, revision_number: 2 },
              { id: R2, document_id: DOC2, revision_number: 5 },
            ],
          },
        ],
        website_documents: [
          {
            data: [
              {
                id: DOC,
                kind: "about",
                page_key: "about",
                program_id: null,
                latest_revision_id: R1,
                published_revision_id: R1,
              },
              {
                id: DOC2,
                kind: "program",
                page_key: null,
                program_id: PROG,
                latest_revision_id: "other",
                published_revision_id: null,
              },
            ],
          },
        ],
        programs: [{ data: [{ id: PROG, name: "Software Testing" }] }],
      },
      storage: { createSignedUrls: { data: [] } },
    });
    const result = await getMediaAsset(A1);
    expect(result.ok && result.data.usage).toEqual([
      {
        documentId: DOC,
        label: "About",
        href: `/admin/website/pages/${DOC}`,
        inPublished: true,
        inLatest: true,
        versionNumbers: [2],
      },
      {
        documentId: DOC2,
        label: "Program: Software Testing",
        href: `/admin/website/programs/${DOC2}`,
        inPublished: false,
        inLatest: false,
        versionNumbers: [5],
      },
    ]);
  });
});

describe("listIncompleteUploads", () => {
  it("says clean-up is not available before the upload policy exists", async () => {
    makeClient({
      rpc: { website_incomplete_media_uploads: { error: { code: "PGRST202" } } },
    });
    expect(await listIncompleteUploads()).toEqual({
      ok: true,
      data: { available: false, items: [] },
    });
  });

  it("maps the listed files", async () => {
    makeClient({
      rpc: {
        website_incomplete_media_uploads: {
          data: [
            {
              storage_path: PATH,
              uploaded_at: "2026-10-21T00:00:00Z",
              byte_size: 512,
              uploaded_by_me: true,
            },
          ],
        },
      },
    });
    expect(await listIncompleteUploads()).toEqual({
      ok: true,
      data: {
        available: true,
        items: [
          {
            path: PATH,
            uploadedAt: "2026-10-21T00:00:00Z",
            byteSize: 512,
            uploadedByMe: true,
          },
        ],
      },
    });
  });
});

describe("Storage", () => {
  it("creates a one-time upload link for exactly the given path, without overwrite", async () => {
    const { storageCalls } = makeClient({
      storage: {
        createSignedUploadUrl: {
          data: { signedUrl: "https://upload", token: "tok", path: PATH },
        },
      },
    });
    expect(await createMediaUploadUrl(PATH)).toEqual({
      ok: true,
      data: { signedUrl: "https://upload", token: "tok" },
    });
    expect(storageCalls).toEqual([
      { bucket: "website-media", method: "createSignedUploadUrl", args: [PATH] },
    ]);
  });

  it("explains that uploads are not enabled when Storage refuses the Admin", async () => {
    makeClient({
      storage: {
        createSignedUploadUrl: {
          error: {
            statusCode: "403",
            message: "new row violates row-level security policy",
          },
        },
      },
    });
    expect(await createMediaUploadUrl(PATH)).toEqual({
      ok: false,
      kind: "not_allowed",
      error: UPLOADS_NOT_ENABLED_MESSAGE,
    });
  });

  it("reads back an uploaded file, and recognises a missing one", async () => {
    makeClient({
      storage: { download: { data: new Blob([new Uint8Array([1, 2, 3])]) } },
    });
    const read = await readStoredMedia(PATH);
    expect(read.ok && Array.from(read.data)).toEqual([1, 2, 3]);
    makeClient({ storage: { download: { error: { statusCode: "404" } } } });
    expect(await readStoredMedia(PATH)).toEqual({ ok: false, missing: true });
  });

  it("removes files and reports how many went", async () => {
    const { storageCalls } = makeClient({
      storage: { remove: { data: [{ name: PATH }] } },
    });
    expect(await removeStoredMedia([PATH])).toBe(1);
    expect(storageCalls[0]).toEqual({
      bucket: "website-media",
      method: "remove",
      args: [[PATH]],
    });
    expect(await removeStoredMedia([])).toBe(0);
  });
});

describe("database writes", () => {
  it("records an image through the 22A function", async () => {
    const { rpcCalls } = makeClient({
      rpc: { website_register_media_asset: { data: A1 } },
    });
    expect(
      await registerMediaAsset({
        path: PATH,
        mimeType: "image/png",
        byteSize: 20480,
        width: 1600,
        height: 900,
        altText: null,
      }),
    ).toEqual({ ok: true, data: { id: A1 } });
    expect(rpcCalls[0]).toEqual({
      fn: "website_register_media_asset",
      args: {
        p_storage_path: PATH,
        p_mime_type: "image/png",
        p_byte_size: 20480,
        p_width: 1600,
        p_height: 900,
        p_alt_text: null,
      },
    });
  });

  it("explains database refusals and hides unexpected errors", async () => {
    makeClient({
      rpc: {
        website_register_media_asset: {
          error: {
            code: "22023",
            message: "The file size does not match the uploaded file",
          },
        },
      },
    });
    expect(
      await registerMediaAsset({
        path: PATH,
        mimeType: "image/png",
        byteSize: 1,
        width: 1,
        height: 1,
        altText: null,
      }),
    ).toEqual({
      ok: false,
      kind: "invalid_input",
      error: "The file size does not match the uploaded file.",
    });

    makeClient({
      rpc: {
        website_register_media_asset: { error: { code: "XX000", message: "secret" } },
      },
    });
    expect(
      await registerMediaAsset({
        path: PATH,
        mimeType: "image/png",
        byteSize: 1,
        width: 1,
        height: 1,
        altText: null,
      }),
    ).toEqual({
      ok: false,
      kind: "unknown",
      error: "Something went wrong. Please try again.",
    });
  });

  it("updates alt text and status with the version seen", async () => {
    const { rpcCalls } = makeClient({ rpc: { website_update_media_asset: { data: 4 } } });
    expect(await updateMediaAsset(A1, 3, "Learners", "approved")).toEqual({
      ok: true,
      data: { version: 4 },
    });
    expect(rpcCalls[0].args).toEqual({
      p_asset_id: A1,
      p_expected_version: 3,
      p_alt_text: "Learners",
      p_status: "approved",
    });

    makeClient({
      rpc: {
        website_update_media_asset: {
          error: {
            code: "P2206",
            message:
              "This image is used by published content; publish a version without it first",
          },
        },
      },
    });
    expect(await updateMediaAsset(A1, 3, "Learners", "retired")).toEqual({
      ok: false,
      kind: "invalid_state",
      error:
        "This image is used by published content; publish a version without it first.",
    });
  });
});

describe("privacy", () => {
  const source = readFileSync(
    path.join(process.cwd(), "lib/data/website-media.ts"),
    "utf8",
  ).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

  it("uses only the signed-in Admin's session (no service-role client)", () => {
    expect(source).not.toMatch(/supabase\/admin|createAdminClient|SERVICE_ROLE/);
  });

  it("never creates a public URL or changes the bucket", () => {
    expect(source).not.toMatch(/getPublicUrl|updateBucket|createBucket|public:\s*true/);
  });
});
