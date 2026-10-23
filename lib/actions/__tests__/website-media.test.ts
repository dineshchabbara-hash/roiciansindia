import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({ getCurrentUserContext: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/data/website-media", () => ({
  createMediaUploadUrl: vi.fn(),
  getMediaAsset: vi.fn(),
  listIncompleteUploads: vi.fn(),
  readStoredMedia: vi.fn(),
  registerMediaAsset: vi.fn(),
  removeStoredMedia: vi.fn(),
  updateMediaAsset: vi.fn(),
}));

import * as actions from "@/lib/actions/website-media";
import { getCurrentUserContext } from "@/lib/auth/session";
import * as data from "@/lib/data/website-media";
import type { MediaAsset } from "@/lib/data/website-media";
import { JPEG_3x2, PNG_3x2, bytes } from "@/lib/domain/__tests__/fixtures/sample-images";

const A1 = "aaaaaaaa-0000-4000-8000-000000000001";
const PNG_PATH = "0f0e0d0c-0b0a-4908-8706-050403020100/hero.png";

type Role = "admin" | "super_admin" | "trainer" | "student";

function signIn(role: Role | null) {
  vi.mocked(getCurrentUserContext).mockResolvedValue(
    role === null
      ? null
      : {
          authUserId: `${role}-auth`,
          email: `${role}@example.com`,
          role,
          profileId: `${role}-profile`,
          displayName: `Test ${role}`,
        },
  );
}

function form(values: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
}

function asset(overrides: Partial<MediaAsset> = {}): MediaAsset {
  return {
    id: A1,
    path: PNG_PATH,
    fileName: "hero.png",
    mimeType: "image/png",
    byteSize: 81,
    width: 3,
    height: 2,
    altText: "Learners in a classroom",
    status: "draft",
    version: 2,
    createdAt: "2026-10-23T10:00:00Z",
    createdByName: null,
    approvedAt: null,
    approvedByName: null,
    updatedAt: "2026-10-23T10:00:00Z",
    previewUrl: null,
    ...overrides,
  };
}

function current(a: MediaAsset) {
  vi.mocked(data.getMediaAsset).mockResolvedValue({
    ok: true,
    data: { asset: a, usage: [] },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  signIn("admin");
  vi.mocked(data.removeStoredMedia).mockResolvedValue(1);
});

describe("role restrictions", () => {
  it.each(["trainer", "student", null] as const)(
    "every media action refuses %s without touching data or Storage",
    async (role) => {
      signIn(role);
      const refused = "Only an Admin or Super Admin can manage website media.";
      expect(
        await actions.prepareMediaUploadAction({
          fileName: "a.png",
          byteSize: 10,
          mimeType: "image/png",
          altText: "",
        }),
      ).toEqual({ ok: false, error: refused });
      expect(
        await actions.completeMediaUploadAction({ path: PNG_PATH, altText: "" }),
      ).toEqual({
        ok: false,
        error: refused,
      });
      for (const action of [
        actions.saveMediaAltTextAction,
        actions.changeMediaStatusAction,
      ]) {
        const result = await action(
          {},
          form({ assetId: A1, expectedVersion: "2", change: "approve" }),
        );
        expect(result.error).toBe(refused);
      }
      expect((await actions.removeIncompleteUploadsAction()).error).toBe(refused);
      for (const fn of Object.values(data)) {
        expect(vi.mocked(fn as () => unknown)).not.toHaveBeenCalled();
      }
    },
  );
});

describe("prepare upload", () => {
  it("creates a one-time link for a new, safe, unique path", async () => {
    vi.mocked(data.createMediaUploadUrl).mockResolvedValue({
      ok: true,
      data: { signedUrl: "https://upload", token: "tok" },
    });
    signIn("super_admin");
    const result = await actions.prepareMediaUploadAction({
      fileName: "Team photo (final).PNG",
      byteSize: 81,
      mimeType: "image/png",
      altText: "",
    });
    expect(result).toMatchObject({ ok: true, token: "tok" });
    if (result.ok) {
      expect(result.path).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/Team-photo-final\.png$/,
      );
      expect(data.createMediaUploadUrl).toHaveBeenCalledWith(result.path);
    }
    const again = await actions.prepareMediaUploadAction({
      fileName: "Team photo (final).PNG",
      byteSize: 81,
      mimeType: "image/png",
      altText: "",
    });
    expect(again.ok && result.ok && again.path !== result.path).toBe(true);
  });

  it("refuses other types, files over 5 MB, unsuitable alt text and malformed input", async () => {
    const cases: Array<[Record<string, unknown>, RegExp]> = [
      [
        { fileName: "a.svg", byteSize: 10, mimeType: "image/svg+xml", altText: "" },
        /Only JPEG, PNG and WebP/,
      ],
      [
        { fileName: "a.gif", byteSize: 10, mimeType: "image/gif", altText: "" },
        /Only JPEG, PNG and WebP/,
      ],
      [
        {
          fileName: "a.png",
          byteSize: 5 * 1024 * 1024 + 1,
          mimeType: "image/png",
          altText: "",
        },
        /larger than 5 MB/,
      ],
      [
        { fileName: "a.png", byteSize: 10, mimeType: "image/png", altText: "IMG_1234" },
        /file name/,
      ],
      [
        { fileName: "", byteSize: 10, mimeType: "image/png", altText: "" },
        /could not be read/,
      ],
      [
        { fileName: "a.png", byteSize: 1.5, mimeType: "image/png", altText: "" },
        /could not be read/,
      ],
    ];
    for (const [input, message] of cases) {
      const result = await actions.prepareMediaUploadAction(input as never);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(message);
    }
    expect(data.createMediaUploadUrl).not.toHaveBeenCalled();
  });

  it("passes on that uploads are not enabled yet", async () => {
    vi.mocked(data.createMediaUploadUrl).mockResolvedValue({
      ok: false,
      kind: "not_allowed",
      error: "Uploading is not enabled yet.",
    });
    expect(
      await actions.prepareMediaUploadAction({
        fileName: "a.png",
        byteSize: 10,
        mimeType: "image/png",
        altText: "",
      }),
    ).toEqual({ ok: false, error: "Uploading is not enabled yet." });
  });
});

describe("complete upload", () => {
  it("checks the stored bytes and records the image as a Draft", async () => {
    vi.mocked(data.readStoredMedia).mockResolvedValue({ ok: true, data: bytes(PNG_3x2) });
    vi.mocked(data.registerMediaAsset).mockResolvedValue({ ok: true, data: { id: A1 } });
    const result = await actions.completeMediaUploadAction({
      path: PNG_PATH,
      altText: "  Learners in a classroom ",
    });
    expect(result).toEqual({ ok: true, id: A1 });
    expect(data.registerMediaAsset).toHaveBeenCalledWith({
      path: PNG_PATH,
      mimeType: "image/png",
      byteSize: bytes(PNG_3x2).length,
      width: 3,
      height: 2,
      altText: "Learners in a classroom",
    });
    expect(data.removeStoredMedia).not.toHaveBeenCalled();
  });

  it("removes a stored file that is not a real image", async () => {
    vi.mocked(data.readStoredMedia).mockResolvedValue({
      ok: true,
      data: new TextEncoder().encode("<html><script>alert(1)</script></html>"),
    });
    const result = await actions.completeMediaUploadAction({
      path: PNG_PATH,
      altText: "",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not a valid JPEG, PNG or WebP/);
    expect(data.removeStoredMedia).toHaveBeenCalledWith([PNG_PATH]);
    expect(data.registerMediaAsset).not.toHaveBeenCalled();
  });

  it("removes a file whose real type differs from the prepared one", async () => {
    vi.mocked(data.readStoredMedia).mockResolvedValue({
      ok: true,
      data: bytes(JPEG_3x2),
    });
    const result = await actions.completeMediaUploadAction({
      path: PNG_PATH,
      altText: "",
    });
    expect(result).toEqual({
      ok: false,
      error: "The uploaded file is not the image that was prepared. Please try again.",
    });
    expect(data.removeStoredMedia).toHaveBeenCalledWith([PNG_PATH]);
  });

  it("removes the file when the database refuses to record it", async () => {
    vi.mocked(data.readStoredMedia).mockResolvedValue({ ok: true, data: bytes(PNG_3x2) });
    vi.mocked(data.registerMediaAsset).mockResolvedValue({
      ok: false,
      kind: "invalid_input",
      error: "The file size does not match the uploaded file.",
    });
    expect(
      await actions.completeMediaUploadAction({ path: PNG_PATH, altText: "" }),
    ).toEqual({
      ok: false,
      error: "The file size does not match the uploaded file.",
    });
    expect(data.removeStoredMedia).toHaveBeenCalledWith([PNG_PATH]);
  });

  it("refuses unsafe paths without touching Storage, and reports a missing upload", async () => {
    for (const path of ["../secret.png", "hero.png", `${PNG_PATH}/x`, 42]) {
      expect(await actions.completeMediaUploadAction({ path, altText: "" })).toEqual({
        ok: false,
        error: "This request could not be read. Reload the page and try again.",
      });
    }
    expect(data.readStoredMedia).not.toHaveBeenCalled();
    vi.mocked(data.readStoredMedia).mockResolvedValue({ ok: false, missing: true });
    expect(
      await actions.completeMediaUploadAction({ path: PNG_PATH, altText: "" }),
    ).toEqual({
      ok: false,
      error: "The upload did not arrive. Please try again.",
    });
    expect(data.removeStoredMedia).not.toHaveBeenCalled();
  });
});

describe("alt text", () => {
  it("saves alt text with the version seen, keeping the status", async () => {
    current(asset({ status: "approved" }));
    vi.mocked(data.updateMediaAsset).mockResolvedValue({
      ok: true,
      data: { version: 3 },
    });
    const result = await actions.saveMediaAltTextAction(
      {},
      form({ assetId: A1, expectedVersion: "2", altText: " Two learners at a laptop " }),
    );
    expect(result).toEqual({ message: "Alt text saved.", version: 3 });
    expect(data.updateMediaAsset).toHaveBeenCalledWith(
      A1,
      2,
      "Two learners at a laptop",
      "approved",
    );
  });

  it("lets a Draft clear its alt text but never an Approved image", async () => {
    current(asset({ status: "draft" }));
    vi.mocked(data.updateMediaAsset).mockResolvedValue({
      ok: true,
      data: { version: 3 },
    });
    await actions.saveMediaAltTextAction(
      {},
      form({ assetId: A1, expectedVersion: "2", altText: "" }),
    );
    expect(data.updateMediaAsset).toHaveBeenCalledWith(A1, 2, null, "draft");

    vi.mocked(data.updateMediaAsset).mockClear();
    current(asset({ status: "approved" }));
    const refusedClear = await actions.saveMediaAltTextAction(
      {},
      form({ assetId: A1, expectedVersion: "2", altText: "" }),
    );
    expect(refusedClear.fieldErrors?.altText?.[0]).toMatch(/Add alt text/);
    expect(data.updateMediaAsset).not.toHaveBeenCalled();
  });

  it("refuses a stale version before writing", async () => {
    current(asset({ version: 5 }));
    const result = await actions.saveMediaAltTextAction(
      {},
      form({ assetId: A1, expectedVersion: "2", altText: "Learners in a classroom" }),
    );
    expect(result.error).toMatch(/Someone else changed this image/);
    expect(data.updateMediaAsset).not.toHaveBeenCalled();
  });
});

describe("status changes", () => {
  it.each([
    ["approve", "draft", "approved", /Image approved/],
    ["withdraw", "approved", "draft", /Approval withdrawn/],
    ["retire", "draft", "retired", /Image retired/],
    ["retire", "approved", "retired", /Image retired/],
    ["restore", "retired", "draft", /restored to Draft/],
  ] as const)("%s from %s leads to %s", async (change, from, to, message) => {
    current(asset({ status: from }));
    vi.mocked(data.updateMediaAsset).mockResolvedValue({
      ok: true,
      data: { version: 3 },
    });
    const result = await actions.changeMediaStatusAction(
      {},
      form({ assetId: A1, expectedVersion: "2", change }),
    );
    expect(result.message).toMatch(message);
    expect(data.updateMediaAsset).toHaveBeenCalledWith(
      A1,
      2,
      "Learners in a classroom",
      to,
    );
  });

  it("refuses approval without suitable alt text", async () => {
    current(asset({ altText: "IMG_1234.jpg" }));
    const result = await actions.changeMediaStatusAction(
      {},
      form({ assetId: A1, expectedVersion: "2", change: "approve" }),
    );
    expect(result.error).toMatch(/Add suitable alt text before approving/);
    expect(data.updateMediaAsset).not.toHaveBeenCalled();
  });

  it("refuses a change that no longer fits the current status, or an unknown change", async () => {
    current(asset({ status: "retired" }));
    const result = await actions.changeMediaStatusAction(
      {},
      form({ assetId: A1, expectedVersion: "2", change: "approve" }),
    );
    expect(result.error).toMatch(/Someone else changed this image/);
    const unknown = await actions.changeMediaStatusAction(
      {},
      form({ assetId: A1, expectedVersion: "2", change: "publish" }),
    );
    expect(unknown.error).toMatch(/could not be read/);
    expect(data.updateMediaAsset).not.toHaveBeenCalled();
  });

  it("passes on the database refusal for an image used by published content", async () => {
    current(asset({ status: "approved" }));
    vi.mocked(data.updateMediaAsset).mockResolvedValue({
      ok: false,
      kind: "invalid_state",
      error:
        "This image is used by published content; publish a version without it first.",
    });
    const result = await actions.changeMediaStatusAction(
      {},
      form({ assetId: A1, expectedVersion: "2", change: "retire" }),
    );
    expect(result.error).toBe(
      "This image is used by published content; publish a version without it first.",
    );
    expect(result.message).toBeUndefined();
  });
});

describe("incomplete uploads", () => {
  it("re-reads the list and removes only what it lists", async () => {
    vi.mocked(data.listIncompleteUploads).mockResolvedValue({
      ok: true,
      data: {
        available: true,
        items: [
          {
            path: PNG_PATH,
            uploadedAt: "2026-10-20T00:00:00Z",
            byteSize: 81,
            uploadedByMe: false,
          },
        ],
      },
    });
    expect(await actions.removeIncompleteUploadsAction()).toEqual({
      message: "Removed 1 incomplete upload.",
    });
    expect(data.removeStoredMedia).toHaveBeenCalledWith([PNG_PATH]);
  });

  it("says when clean-up is not available yet, or there is nothing to remove", async () => {
    vi.mocked(data.listIncompleteUploads).mockResolvedValue({
      ok: true,
      data: { available: false, items: [] },
    });
    expect((await actions.removeIncompleteUploadsAction()).error).toMatch(
      /not available until/,
    );
    vi.mocked(data.listIncompleteUploads).mockResolvedValue({
      ok: true,
      data: { available: true, items: [] },
    });
    expect((await actions.removeIncompleteUploadsAction()).message).toMatch(
      /no incomplete uploads/,
    );
    expect(data.removeStoredMedia).not.toHaveBeenCalled();
  });
});
