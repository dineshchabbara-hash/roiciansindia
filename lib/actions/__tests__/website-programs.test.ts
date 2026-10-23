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
    saveWebsiteDraft: vi.fn(),
    publishWebsitePage: vi.fn(),
    unpublishWebsitePage: vi.fn(),
    restoreWebsiteRevision: vi.fn(),
  };
});
vi.mock("@/lib/data/website-programs", () => ({
  changeProgramSlug: vi.fn(),
  createDisplayGroup: vi.fn(),
  createProgramWebsite: vi.fn(),
  getBatchProgramId: vi.fn(),
  getPlacementRows: vi.fn(),
  getProgramWebsite: vi.fn(),
  listDisplayGroups: vi.fn(),
  listProgramWebsiteEntries: vi.fn(),
  publishBatch: vi.fn(),
  reorderDisplayGroups: vi.fn(),
  saveBatchPublication: vi.fn(),
  unpublishBatch: vi.fn(),
  updateDisplayGroup: vi.fn(),
  updateProgramPlacement: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));

import * as actions from "@/lib/actions/website-programs";
import { getCurrentUserContext } from "@/lib/auth/session";
import {
  publishWebsitePage,
  restoreWebsiteRevision,
  saveWebsiteDraft,
  unpublishWebsitePage,
} from "@/lib/data/website";
import * as data from "@/lib/data/website-programs";
import type {
  ProgramPlacement,
  ProgramWebsiteDetail,
  ProgramWebsiteSummary,
} from "@/lib/data/website-programs";
import { STALE_EDIT_MESSAGE } from "@/lib/domain/website";
import {
  PROGRAM_NOT_ACTIVE_MESSAGE,
  PUBLISHED_SLUG_LOCKED_MESSAGE,
} from "@/lib/domain/website-programs";

const P1 = "11111111-0000-4000-8000-000000000001";
const P2 = "11111111-0000-4000-8000-000000000002";
const DOC = "aaaaaaaa-0000-4000-8000-000000000001";
const DOC2 = "aaaaaaaa-0000-4000-8000-000000000002";
const DOC3 = "aaaaaaaa-0000-4000-8000-000000000003";
const REV = "bbbbbbbb-0000-4000-8000-000000000001";
const G1 = "dddddddd-0000-4000-8000-000000000001";
const G2 = "dddddddd-0000-4000-8000-000000000002";
const B1 = "eeeeeeee-0000-4000-8000-000000000001";

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

const placement: ProgramPlacement = {
  displayGroupId: G1,
  displayGroupName: "Quality Engineering",
  isFeatured: false,
  featuredOrder: null,
  displayOrder: 3,
};

function detail(
  overrides: {
    status?: ProgramWebsiteDetail["program"]["status"];
    firstPublishedAt?: string | null;
  } = {},
): ProgramWebsiteDetail {
  return {
    program: {
      id: P1,
      code: "ST-01",
      name: "Software Testing",
      status: overrides.status ?? "active",
    },
    document: {
      id: DOC,
      slug: "software-testing",
      status: "draft",
      title: "Software Testing Pro",
      latestRevisionId: REV,
      latestRevisionNumber: 1,
      publishedRevisionId: null,
      version: 4,
      firstPublishedAt: overrides.firstPublishedAt ?? null,
      publishedAt: null,
      unpublishedAt: null,
      updatedAt: "2026-10-23T10:00:00Z",
      placement,
      publishedRevisionNumber: null,
      updatedByName: null,
      publishedByName: null,
    },
    latest: null,
  };
}

function summary(
  id: string,
  programId: string,
  p: Partial<typeof placement> = {},
): ProgramWebsiteSummary {
  return {
    program: { id: programId, code: programId.slice(-2), name: "P", status: "active" },
    document: {
      ...detail().document,
      id,
      placement: { ...placement, ...p },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  signIn("admin");
});

// Every action with a minimal valid-looking form.
const ALL_ACTIONS: Array<[string, (s: never, f: FormData) => Promise<unknown>]> = [
  ["createProgramWebsiteAction", actions.createProgramWebsiteAction],
  ["saveProgramDraftAction", actions.saveProgramDraftAction],
  ["publishProgramAction", actions.publishProgramAction],
  ["unpublishProgramAction", actions.unpublishProgramAction],
  ["restoreProgramRevisionAction", actions.restoreProgramRevisionAction],
  ["changeProgramSlugAction", actions.changeProgramSlugAction],
  ["updateProgramPlacementAction", actions.updateProgramPlacementAction],
  ["moveFeaturedProgramAction", actions.moveFeaturedProgramAction],
  ["removeFeaturedProgramAction", actions.removeFeaturedProgramAction],
  ["createDisplayGroupAction", actions.createDisplayGroupAction],
  ["updateDisplayGroupAction", actions.updateDisplayGroupAction],
  ["moveDisplayGroupAction", actions.moveDisplayGroupAction],
  ["saveBatchPublicationAction", actions.saveBatchPublicationAction],
  ["publishBatchAction", actions.publishBatchAction],
  ["unpublishBatchAction", actions.unpublishBatchAction],
];

describe("role restrictions", () => {
  it.each(["trainer", "student", null] as const)(
    "every action refuses %s without touching data",
    async (role) => {
      signIn(role);
      for (const [name, action] of ALL_ACTIONS) {
        const result = (await action({} as never, form({ documentId: DOC }))) as {
          error?: string;
        };
        expect(result.error, name).toBe(
          "Only an Admin or Super Admin can manage website content.",
        );
      }
      for (const fn of Object.values(data)) {
        expect(vi.mocked(fn as () => unknown)).not.toHaveBeenCalled();
      }
      expect(saveWebsiteDraft).not.toHaveBeenCalled();
      expect(publishWebsitePage).not.toHaveBeenCalled();
    },
  );

  it("allows a Super Admin as well as an Admin", async () => {
    signIn("super_admin");
    vi.mocked(data.createDisplayGroup).mockResolvedValue({ ok: true, data: { id: G1 } });
    const result = await actions.createDisplayGroupAction(
      {},
      form({ name: "Data and AI" }),
    );
    expect(result.message).toBe('Display group "Data and AI" created.');
  });
});

describe("Program website content", () => {
  it("creates website content with a valid slug and opens the editor", async () => {
    vi.mocked(data.listProgramWebsiteEntries).mockResolvedValue({
      ok: true,
      data: [
        { program: { id: P1, code: "ST", name: "ST", status: "draft" }, document: null },
      ],
    });
    vi.mocked(data.createProgramWebsite).mockResolvedValue({
      ok: true,
      data: { id: DOC },
    });
    await expect(
      actions.createProgramWebsiteAction(
        {},
        form({ programId: P1, slug: "software-testing" }),
      ),
    ).rejects.toThrow(`REDIRECT:/admin/website/programs/${DOC}`);
    expect(data.createProgramWebsite).toHaveBeenCalledWith(P1, "software-testing");
  });

  it("refuses an invalid slug before any database call", async () => {
    const result = await actions.createProgramWebsiteAction(
      {},
      form({ programId: P1, slug: "Bad Slug!" }),
    );
    expect(result.fieldErrors?.slug?.[0]).toMatch(/lowercase letters/);
    expect(data.createProgramWebsite).not.toHaveBeenCalled();
  });

  it("refuses an archived Program", async () => {
    vi.mocked(data.listProgramWebsiteEntries).mockResolvedValue({
      ok: true,
      data: [
        { program: { id: P1, code: "X", name: "X", status: "archived" }, document: null },
      ],
    });
    const result = await actions.createProgramWebsiteAction(
      {},
      form({ programId: P1, slug: "old-program" }),
    );
    expect(result.error).toBe("An archived Program cannot get website content.");
    expect(data.createProgramWebsite).not.toHaveBeenCalled();
  });

  it("saves a draft validated as Program content (no prices)", async () => {
    vi.mocked(data.getProgramWebsite).mockResolvedValue({ ok: true, data: detail() });
    const draft = {
      baseRevisionNumber: 1,
      title: "Software Testing Pro for ₹49,999",
      sections: [],
    };
    const result = await actions.saveProgramDraftAction(
      {},
      form({ documentId: DOC, draft: JSON.stringify(draft) }),
    );
    expect(result.fieldErrors?.title?.[0]).toMatch(/must not show prices/);
    expect(saveWebsiteDraft).not.toHaveBeenCalled();
  });

  it("saves a valid draft and reports a stale save with the latest number", async () => {
    vi.mocked(data.getProgramWebsite).mockResolvedValue({ ok: true, data: detail() });
    vi.mocked(saveWebsiteDraft).mockResolvedValueOnce({
      ok: true,
      data: { revisionId: REV, revisionNumber: 2 },
    });
    const ok = await actions.saveProgramDraftAction(
      {},
      form({
        documentId: DOC,
        draft: JSON.stringify({
          baseRevisionNumber: 1,
          title: "Software Testing Pro",
          sections: [],
        }),
      }),
    );
    expect(ok.saved).toEqual({ revisionId: REV, revisionNumber: 2 });

    vi.mocked(saveWebsiteDraft).mockResolvedValueOnce({
      ok: false,
      kind: "stale",
      error: STALE_EDIT_MESSAGE,
    });
    const stale = await actions.saveProgramDraftAction(
      {},
      form({
        documentId: DOC,
        draft: JSON.stringify({ baseRevisionNumber: 1, title: "Mine", sections: [] }),
      }),
    );
    expect(stale.error).toBe(STALE_EDIT_MESSAGE);
    expect(stale.stale).toEqual({ latestRevisionNumber: 1 });
  });

  it("refuses to publish a Program that is not active in the LMS, before any database call", async () => {
    vi.mocked(data.getProgramWebsite).mockResolvedValue({
      ok: true,
      data: detail({ status: "draft" }),
    });
    const result = await actions.publishProgramAction(
      {},
      form({ documentId: DOC, revisionId: REV }),
    );
    expect(result.error).toBe(PROGRAM_NOT_ACTIVE_MESSAGE);
    expect(publishWebsitePage).not.toHaveBeenCalled();
  });

  it("publishes an active Program's latest version", async () => {
    vi.mocked(data.getProgramWebsite).mockResolvedValue({ ok: true, data: detail() });
    vi.mocked(publishWebsitePage).mockResolvedValue({ ok: true, data: null });
    const result = await actions.publishProgramAction(
      {},
      form({ documentId: DOC, revisionId: REV }),
    );
    expect(result.message).toMatch(/now the live content for this Program/);
    expect(publishWebsitePage).toHaveBeenCalledWith(DOC, REV);
  });

  it("only unpublishes or restores a Program document", async () => {
    vi.mocked(data.getProgramWebsite).mockResolvedValue({
      ok: false,
      error: "This Program's website content could not be found.",
    });
    const u = await actions.unpublishProgramAction(
      {},
      form({ documentId: DOC, expectedVersion: "4" }),
    );
    const r = await actions.restoreProgramRevisionAction(
      {},
      form({ documentId: DOC, sourceRevisionId: REV, baseRevisionNumber: "1" }),
    );
    expect(u.error).toMatch(/could not be found/);
    expect(r.error).toMatch(/could not be found/);
    expect(unpublishWebsitePage).not.toHaveBeenCalled();
    expect(restoreWebsiteRevision).not.toHaveBeenCalled();
  });

  it("restores into a new draft and reopens the Program editor", async () => {
    vi.mocked(data.getProgramWebsite).mockResolvedValue({ ok: true, data: detail() });
    vi.mocked(restoreWebsiteRevision).mockResolvedValue({
      ok: true,
      data: { revisionId: REV, revisionNumber: 3 },
    });
    await expect(
      actions.restoreProgramRevisionAction(
        {},
        form({ documentId: DOC, sourceRevisionId: REV, baseRevisionNumber: "2" }),
      ),
    ).rejects.toThrow(`REDIRECT:/admin/website/programs/${DOC}?restored=3`);
  });
});

describe("web address (slug)", () => {
  it.each(["admin", "super_admin"] as const)(
    "refuses to change a published Program's slug for %s, before any database call",
    async (role) => {
      signIn(role);
      vi.mocked(data.getProgramWebsite).mockResolvedValue({
        ok: true,
        data: detail({ firstPublishedAt: "2026-10-23T10:00:00Z" }),
      });
      const result = await actions.changeProgramSlugAction(
        {},
        form({ documentId: DOC, expectedVersion: "4", slug: "new-address" }),
      );
      expect(result.error).toBe(PUBLISHED_SLUG_LOCKED_MESSAGE);
      expect(data.changeProgramSlug).not.toHaveBeenCalled();
    },
  );

  it("changes a never-published Program's slug with the expected version", async () => {
    vi.mocked(data.getProgramWebsite).mockResolvedValue({ ok: true, data: detail() });
    vi.mocked(data.changeProgramSlug).mockResolvedValue({
      ok: true,
      data: { version: 5 },
    });
    const result = await actions.changeProgramSlugAction(
      {},
      form({ documentId: DOC, expectedVersion: "4", slug: "software-testing-pro" }),
    );
    expect(result).toMatchObject({ message: "Web address changed.", version: 5 });
    expect(data.changeProgramSlug).toHaveBeenCalledWith(DOC, 4, "software-testing-pro");
  });

  it("refuses an unchanged slug", async () => {
    vi.mocked(data.getProgramWebsite).mockResolvedValue({ ok: true, data: detail() });
    const result = await actions.changeProgramSlugAction(
      {},
      form({ documentId: DOC, expectedVersion: "4", slug: "software-testing" }),
    );
    expect(result.error).toBe("The web address is unchanged.");
  });
});

describe("placement and featured Programs", () => {
  it("saves placement, putting a newly featured Program last", async () => {
    vi.mocked(data.listProgramWebsiteEntries).mockResolvedValue({
      ok: true,
      data: [
        summary(DOC2, P2, { isFeatured: true, featuredOrder: 1 }),
        summary(DOC3, P2, { isFeatured: true, featuredOrder: 4 }),
      ],
    });
    vi.mocked(data.updateProgramPlacement).mockResolvedValue({
      ok: true,
      data: { version: 5 },
    });
    const result = await actions.updateProgramPlacementAction(
      {},
      form({
        documentId: DOC,
        expectedVersion: "4",
        displayGroupId: G2,
        displayOrder: "2",
        isFeatured: "on",
        featuredOrder: "",
      }),
    );
    expect(result.version).toBe(5);
    expect(data.updateProgramPlacement).toHaveBeenCalledWith(DOC, 4, {
      displayGroupId: G2,
      isFeatured: true,
      displayOrder: 2,
      featuredOrder: 5,
    });
  });

  it("refuses an out-of-range position", async () => {
    const result = await actions.updateProgramPlacementAction(
      {},
      form({
        documentId: DOC,
        expectedVersion: "4",
        displayOrder: "0",
        featuredOrder: "",
      }),
    );
    expect(result.fieldErrors?.displayOrder).toBeDefined();
    expect(data.updateProgramPlacement).not.toHaveBeenCalled();
  });

  it("moves a featured Program, writing only the positions that change", async () => {
    vi.mocked(data.listProgramWebsiteEntries).mockResolvedValue({
      ok: true,
      data: [
        summary(DOC, P1, { isFeatured: true, featuredOrder: 1 }),
        summary(DOC2, P2, { isFeatured: true, featuredOrder: 2 }),
        summary(DOC3, P2, { isFeatured: true, featuredOrder: 3 }),
      ],
    });
    const row = (order: number, version: number) => ({
      version,
      placement: { ...placement, isFeatured: true, featuredOrder: order },
    });
    vi.mocked(data.getPlacementRows).mockResolvedValue({
      ok: true,
      data: new Map([
        [DOC, row(1, 7)],
        [DOC2, row(2, 8)],
        [DOC3, row(3, 9)],
      ]),
    });
    vi.mocked(data.updateProgramPlacement).mockResolvedValue({
      ok: true,
      data: { version: 10 },
    });
    const seen = JSON.stringify([
      { id: DOC, version: 7 },
      { id: DOC2, version: 8 },
      { id: DOC3, version: 9 },
    ]);
    const result = await actions.moveFeaturedProgramAction(
      {},
      form({ documentId: DOC2, direction: "up", seen }),
    );
    expect(result.message).toMatch(/Featured order saved/);
    expect(vi.mocked(data.updateProgramPlacement).mock.calls).toEqual([
      [DOC2, 8, { ...placement, isFeatured: true, featuredOrder: 1 }],
      [DOC, 7, { ...placement, isFeatured: true, featuredOrder: 2 }],
    ]);
  });

  it("writes nothing when the featured list changed since it was shown", async () => {
    vi.mocked(data.listProgramWebsiteEntries).mockResolvedValue({
      ok: true,
      data: [
        summary(DOC, P1, { isFeatured: true, featuredOrder: 1 }),
        summary(DOC2, P2, { isFeatured: true, featuredOrder: 2 }),
      ],
    });
    vi.mocked(data.getPlacementRows).mockResolvedValue({
      ok: true,
      data: new Map([
        [
          DOC,
          { version: 7, placement: { ...placement, isFeatured: true, featuredOrder: 1 } },
        ],
        [
          DOC2,
          {
            version: 99,
            placement: { ...placement, isFeatured: true, featuredOrder: 2 },
          },
        ],
      ]),
    });
    const result = await actions.moveFeaturedProgramAction(
      {},
      form({
        documentId: DOC2,
        direction: "up",
        seen: JSON.stringify([
          { id: DOC, version: 7 },
          { id: DOC2, version: 8 },
        ]),
      }),
    );
    expect(result.error).toMatch(/list changed/);
    expect(data.updateProgramPlacement).not.toHaveBeenCalled();
  });

  it("removes a Program from featured, keeping its group and order", async () => {
    vi.mocked(data.getPlacementRows).mockResolvedValue({
      ok: true,
      data: new Map([
        [
          DOC,
          { version: 4, placement: { ...placement, isFeatured: true, featuredOrder: 2 } },
        ],
      ]),
    });
    vi.mocked(data.updateProgramPlacement).mockResolvedValue({
      ok: true,
      data: { version: 5 },
    });
    await actions.removeFeaturedProgramAction(
      {},
      form({ documentId: DOC, expectedVersion: "4" }),
    );
    expect(data.updateProgramPlacement).toHaveBeenCalledWith(DOC, 4, {
      ...placement,
      isFeatured: false,
      featuredOrder: null,
    });
  });
});

describe("display groups", () => {
  it("validates group names", async () => {
    const result = await actions.createDisplayGroupAction({}, form({ name: "  " }));
    expect(result.fieldErrors?.name?.[0]).toBe("Group name is required.");
    expect(data.createDisplayGroup).not.toHaveBeenCalled();
  });

  it("renames and hides a group with its version", async () => {
    vi.mocked(data.updateDisplayGroup).mockResolvedValue({
      ok: true,
      data: { version: 3 },
    });
    await actions.updateDisplayGroupAction(
      {},
      form({ groupId: G1, expectedVersion: "2", name: "Data and AI", description: "" }),
    );
    expect(data.updateDisplayGroup).toHaveBeenCalledWith(G1, 2, {
      name: "Data and AI",
      description: null,
      isVisible: false,
    });
  });

  it("reorders the whole list it was shown, and refuses a changed list", async () => {
    vi.mocked(data.listDisplayGroups).mockResolvedValue({
      ok: true,
      data: [G1, G2].map((id, i) => ({
        id,
        name: id,
        description: null,
        displayOrder: i + 1,
        isVisible: true,
        version: 1,
        programCount: 0,
      })),
    });
    vi.mocked(data.reorderDisplayGroups).mockResolvedValue({ ok: true, data: null });
    await actions.moveDisplayGroupAction(
      {},
      form({ groupId: G2, direction: "up", orderedIds: JSON.stringify([G1, G2]) }),
    );
    expect(data.reorderDisplayGroups).toHaveBeenCalledWith([G2, G1]);

    vi.mocked(data.reorderDisplayGroups).mockClear();
    const stale = await actions.moveDisplayGroupAction(
      {},
      form({ groupId: G2, direction: "down", orderedIds: JSON.stringify([G2, G1]) }),
    );
    expect(stale.error).toMatch(/list changed/);
    expect(data.reorderDisplayGroups).not.toHaveBeenCalled();
  });
});

describe("Batch website publication", () => {
  it("refuses a Batch from another Program", async () => {
    vi.mocked(data.getProgramWebsite).mockResolvedValue({ ok: true, data: detail() });
    vi.mocked(data.getBatchProgramId).mockResolvedValue(P2);
    const result = await actions.publishBatchAction(
      {},
      form({ documentId: DOC, batchId: B1, expectedVersion: "1" }),
    );
    expect(result.error).toBe("This Batch does not belong to this Program.");
    expect(data.publishBatch).not.toHaveBeenCalled();
  });

  it("saves a public label and registration state", async () => {
    vi.mocked(data.getProgramWebsite).mockResolvedValue({ ok: true, data: detail() });
    vi.mocked(data.getBatchProgramId).mockResolvedValue(P1);
    vi.mocked(data.saveBatchPublication).mockResolvedValue({
      ok: true,
      data: { version: 1 },
    });
    const result = await actions.saveBatchPublicationAction(
      {},
      form({
        documentId: DOC,
        batchId: B1,
        expectedVersion: "0",
        publicLabel: "Weekend batch, starts 6 March",
        registrationState: "open",
      }),
    );
    expect(result.version).toBe(1);
    expect(data.saveBatchPublication).toHaveBeenCalledWith(B1, 0, {
      publicLabel: "Weekend batch, starts 6 March",
      registrationState: "open",
    });
  });

  it("refuses a state other than Open, Closed or Full, and a priced label", async () => {
    vi.mocked(data.getProgramWebsite).mockResolvedValue({ ok: true, data: detail() });
    vi.mocked(data.getBatchProgramId).mockResolvedValue(P1);
    const result = await actions.saveBatchPublicationAction(
      {},
      form({
        documentId: DOC,
        batchId: B1,
        expectedVersion: "0",
        publicLabel: "Only ₹9,999",
        registrationState: "waitlist",
      }),
    );
    expect(result.fieldErrors?.publicLabel?.[0]).toMatch(/must not show prices/);
    expect(result.fieldErrors?.registrationState?.[0]).toBe(
      "Choose Open, Closed or Full.",
    );
    expect(data.saveBatchPublication).not.toHaveBeenCalled();
  });

  it("publishes and unpublishes with the expected version", async () => {
    vi.mocked(data.getProgramWebsite).mockResolvedValue({ ok: true, data: detail() });
    vi.mocked(data.getBatchProgramId).mockResolvedValue(P1);
    vi.mocked(data.publishBatch).mockResolvedValue({ ok: true, data: { version: 2 } });
    vi.mocked(data.unpublishBatch).mockResolvedValue({ ok: true, data: { version: 3 } });
    await actions.publishBatchAction(
      {},
      form({ documentId: DOC, batchId: B1, expectedVersion: "1" }),
    );
    await actions.unpublishBatchAction(
      {},
      form({ documentId: DOC, batchId: B1, expectedVersion: "2" }),
    );
    expect(data.publishBatch).toHaveBeenCalledWith(B1, 1);
    expect(data.unpublishBatch).toHaveBeenCalledWith(B1, 2);
  });
});
