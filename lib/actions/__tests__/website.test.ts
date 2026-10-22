import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({ getCurrentUserContext: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));
vi.mock("@/lib/data/website", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/data/website")>();
  return {
    isUuid: actual.isUuid,
    createWebsitePage: vi.fn(),
    getWebsitePage: vi.fn(),
    saveWebsiteDraft: vi.fn(),
    publishWebsitePage: vi.fn(),
    unpublishWebsitePage: vi.fn(),
    restoreWebsiteRevision: vi.fn(),
  };
});
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));

import {
  createWebsitePageAction,
  publishWebsitePageAction,
  restoreWebsiteRevisionAction,
  saveWebsiteDraftAction,
  unpublishWebsitePageAction,
} from "@/lib/actions/website";
import { getCurrentUserContext } from "@/lib/auth/session";
import { revalidatePath } from "next/cache";
import {
  createWebsitePage,
  getWebsitePage,
  publishWebsitePage,
  restoreWebsiteRevision,
  saveWebsiteDraft,
  unpublishWebsitePage,
  type WebsitePageDetail,
} from "@/lib/data/website";
import { STALE_EDIT_MESSAGE } from "@/lib/domain/website";
import { LEGAL_PUBLICATION_HELD_MESSAGE } from "@/lib/domain/website-admin";

const DOC = "aaaaaaaa-0000-4000-8000-000000000001";
const REV1 = "bbbbbbbb-0000-4000-8000-000000000001";
const REV2 = "bbbbbbbb-0000-4000-8000-000000000002";

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

function page(overrides: Partial<WebsitePageDetail> = {}): WebsitePageDetail {
  return {
    id: DOC,
    kind: "home",
    pageKey: "home",
    title: "Home",
    status: "draft",
    latestRevisionId: REV2,
    latestRevisionNumber: 2,
    publishedRevisionId: null,
    version: 3,
    updatedAt: "2026-10-22T00:00:00Z",
    updatedByName: null,
    publishedAt: null,
    publishedByName: null,
    firstPublishedAt: null,
    unpublishedAt: null,
    latest: null,
    publishedRevisionNumber: null,
    ...overrides,
  };
}

function form(values: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
}

function draftForm(draft: Record<string, unknown>, documentId = DOC) {
  return form({
    documentId,
    draft: JSON.stringify({
      baseRevisionNumber: 2,
      title: "Practical technology training",
      summary: null,
      seoTitle: null,
      seoDescription: null,
      socialTitle: null,
      socialDescription: null,
      heroImageAssetId: null,
      socialImageAssetId: null,
      sections: [],
      ...draft,
    }),
  });
}

const DATA_CALLS = [
  createWebsitePage,
  getWebsitePage,
  saveWebsiteDraft,
  publishWebsitePage,
  unpublishWebsitePage,
  restoreWebsiteRevision,
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getWebsitePage).mockResolvedValue({ ok: true, data: page() });
});

describe("role restrictions", () => {
  const actions = {
    create: () => createWebsitePageAction({}, form({ kind: "home" })),
    save: () => saveWebsiteDraftAction({}, draftForm({})),
    publish: () =>
      publishWebsitePageAction({}, form({ documentId: DOC, revisionId: REV2 })),
    unpublish: () =>
      unpublishWebsitePageAction({}, form({ documentId: DOC, expectedVersion: "3" })),
    restore: () =>
      restoreWebsiteRevisionAction(
        {},
        form({ documentId: DOC, sourceRevisionId: REV1, baseRevisionNumber: "2" }),
      ),
  };

  for (const role of ["trainer", "student", null] as const) {
    for (const [name, run] of Object.entries(actions)) {
      it(`refuses ${name} for ${role ?? "no session"} without touching data`, async () => {
        signIn(role);
        const state = await run();
        expect(state.error).toMatch(/Only an Admin or Super Admin/);
        for (const call of DATA_CALLS) expect(call).not.toHaveBeenCalled();
      });
    }
  }
});

describe("createWebsitePageAction", () => {
  it("uses the fixed key for a one-per-site page, ignoring any submitted key", async () => {
    signIn("admin");
    vi.mocked(createWebsitePage).mockResolvedValue({ ok: true, data: { id: DOC } });
    await expect(
      createWebsitePageAction({}, form({ kind: "corporate_training", pageKey: "evil" })),
    ).rejects.toThrow(`REDIRECT:/admin/website/pages/${DOC}`);
    expect(createWebsitePage).toHaveBeenCalledWith(
      "corporate_training",
      "corporate-training",
    );
  });

  it("validates a legal page key before calling the database", async () => {
    signIn("super_admin");
    const state = await createWebsitePageAction(
      {},
      form({ kind: "legal", pageKey: "Home" }),
    );
    expect(state.fieldErrors?.pageKey?.[0]).toMatch(/lowercase/);
    expect(createWebsitePage).not.toHaveBeenCalled();
  });

  it("refuses Program pages (22B-2) and unknown types", async () => {
    signIn("admin");
    for (const kind of ["program", "scripts", ""]) {
      const state = await createWebsitePageAction({}, form({ kind }));
      expect(state.error).toBe("Choose a supported page type.");
    }
    expect(createWebsitePage).not.toHaveBeenCalled();
  });

  it("reports an existing page", async () => {
    signIn("admin");
    vi.mocked(createWebsitePage).mockResolvedValue({
      ok: false,
      kind: "duplicate",
      error: "That page already exists.",
    });
    expect((await createWebsitePageAction({}, form({ kind: "home" }))).error).toBe(
      "That page already exists.",
    );
  });
});

describe("saveWebsiteDraftAction", () => {
  it("validates against the stored page type, not anything the browser claims", async () => {
    signIn("admin");
    vi.mocked(getWebsitePage).mockResolvedValue({
      ok: true,
      data: page({ kind: "navigation", pageKey: "navigation" }),
    });
    const state = await saveWebsiteDraftAction(
      {},
      draftForm({
        kind: "home",
        sections: [{ key: "hero", type: "hero", visible: true }],
      }),
    );
    expect(state.error).toBe("Check the highlighted fields.");
    expect(state.fieldErrors?.["sections.0.type"]?.[0]).toMatch(/not supported/);
    expect(saveWebsiteDraft).not.toHaveBeenCalled();
  });

  it("refuses markup, prices and unsafe links with field paths", async () => {
    signIn("admin");
    const state = await saveWebsiteDraftAction(
      {},
      draftForm({
        title: "<script>x</script>",
        sections: [
          {
            key: "cta",
            type: "cta",
            visible: true,
            body: "Only ₹999",
            cta: { label: "Go", href: "javascript:alert(1)" },
          },
        ],
      }),
    );
    expect(state.fieldErrors?.title?.[0]).toMatch(/plain text/);
    expect(state.fieldErrors?.["sections.0.body"]?.[0]).toMatch(/prices/);
    expect(state.fieldErrors?.["sections.0.cta.href"]?.[0]).toMatch(/Links must be/);
    expect(saveWebsiteDraft).not.toHaveBeenCalled();
  });

  it("refuses unreadable input", async () => {
    signIn("admin");
    expect(
      (await saveWebsiteDraftAction({}, form({ documentId: DOC, draft: "{" }))).error,
    ).toMatch(/could not be read/);
    expect((await saveWebsiteDraftAction({}, draftForm({}, "nope"))).error).toMatch(
      /could not be read/,
    );
  });

  it("saves with the base revision number the editor loaded", async () => {
    signIn("super_admin");
    vi.mocked(saveWebsiteDraft).mockResolvedValue({
      ok: true,
      data: { revisionId: "r3", revisionNumber: 3 },
    });
    const state = await saveWebsiteDraftAction(
      {},
      draftForm({
        sections: [{ key: "intro", type: "text", visible: true, body: "Hello" }],
      }),
    );
    expect(saveWebsiteDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: DOC,
        baseRevisionNumber: 2,
        title: "Practical technology training",
      }),
    );
    expect(state.saved).toEqual({ revisionId: "r3", revisionNumber: 3 });
    expect(state.message).toMatch(/version 3.*not public/);
    expect(revalidatePath).toHaveBeenCalledWith("/admin/website");
  });

  it("reports a stale save with the latest version number and keeps nothing else", async () => {
    signIn("admin");
    vi.mocked(saveWebsiteDraft).mockResolvedValue({
      ok: false,
      kind: "stale",
      error: STALE_EDIT_MESSAGE,
    });
    vi.mocked(getWebsitePage)
      .mockResolvedValueOnce({ ok: true, data: page() })
      .mockResolvedValueOnce({ ok: true, data: page({ latestRevisionNumber: 4 }) });
    const state = await saveWebsiteDraftAction({}, draftForm({}));
    expect(state.error).toBe(STALE_EDIT_MESSAGE);
    expect(state.stale).toEqual({ latestRevisionNumber: 4 });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("publishWebsitePageAction", () => {
  it("publishes the named version", async () => {
    signIn("admin");
    vi.mocked(publishWebsitePage).mockResolvedValue({ ok: true, data: null });
    const state = await publishWebsitePageAction(
      {},
      form({ documentId: DOC, revisionId: REV2 }),
    );
    expect(publishWebsitePage).toHaveBeenCalledWith(DOC, REV2);
    expect(state.message).toMatch(/Published/);
  });

  it.each(["admin", "super_admin"] as const)(
    "refuses to publish a legal page for %s before any database call",
    async (role) => {
      signIn(role);
      vi.mocked(getWebsitePage).mockResolvedValue({
        ok: true,
        data: page({ kind: "legal", pageKey: "privacy-policy" }),
      });
      const state = await publishWebsitePageAction(
        {},
        form({ documentId: DOC, revisionId: REV2 }),
      );
      expect(state.error).toBe(LEGAL_PUBLICATION_HELD_MESSAGE);
      expect(publishWebsitePage).not.toHaveBeenCalled();
    },
  );

  it("marks a stale publish", async () => {
    signIn("admin");
    vi.mocked(publishWebsitePage).mockResolvedValue({
      ok: false,
      kind: "stale",
      error: STALE_EDIT_MESSAGE,
    });
    const state = await publishWebsitePageAction(
      {},
      form({ documentId: DOC, revisionId: REV1 }),
    );
    expect(state.error).toBe(STALE_EDIT_MESSAGE);
    expect(state.stale).toEqual({ latestRevisionNumber: 2 });
  });
});

describe("unpublishWebsitePageAction", () => {
  it("passes the expected version", async () => {
    signIn("admin");
    vi.mocked(unpublishWebsitePage).mockResolvedValue({ ok: true, data: { version: 4 } });
    const state = await unpublishWebsitePageAction(
      {},
      form({ documentId: DOC, expectedVersion: "3" }),
    );
    expect(unpublishWebsitePage).toHaveBeenCalledWith(DOC, 3);
    expect(state.message).toMatch(/Unpublished/);
  });

  it("refuses a malformed version", async () => {
    signIn("admin");
    const state = await unpublishWebsitePageAction(
      {},
      form({ documentId: DOC, expectedVersion: "-1" }),
    );
    expect(state.error).toMatch(/could not be read/);
    expect(unpublishWebsitePage).not.toHaveBeenCalled();
  });
});

describe("restoreWebsiteRevisionAction", () => {
  it("restores as a new draft and returns to the editor", async () => {
    signIn("super_admin");
    vi.mocked(restoreWebsiteRevision).mockResolvedValue({
      ok: true,
      data: { revisionId: "r3", revisionNumber: 3 },
    });
    await expect(
      restoreWebsiteRevisionAction(
        {},
        form({ documentId: DOC, sourceRevisionId: REV1, baseRevisionNumber: "2" }),
      ),
    ).rejects.toThrow(`REDIRECT:/admin/website/pages/${DOC}?restored=3`);
    expect(restoreWebsiteRevision).toHaveBeenCalledWith(DOC, REV1, 2);
  });

  it("shows the stale message when another version was saved first", async () => {
    signIn("admin");
    vi.mocked(restoreWebsiteRevision).mockResolvedValue({
      ok: false,
      kind: "stale",
      error: STALE_EDIT_MESSAGE,
    });
    const state = await restoreWebsiteRevisionAction(
      {},
      form({ documentId: DOC, sourceRevisionId: REV1, baseRevisionNumber: "1" }),
    );
    expect(state.error).toBe(STALE_EDIT_MESSAGE);
  });
});
