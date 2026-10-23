import { describe, expect, it } from "vitest";
import {
  BATCH_STATUS_LABELS,
  GROUP_HAS_PROGRAMS_MESSAGE,
  GROUP_RESTORE_NAME_TAKEN_MESSAGE,
  batchCanBePublished,
  batchPublicationStatus,
  featuredOrderChanges,
  isProgramSlugLocked,
  moveInList,
  nextFeaturedOrder,
  programCanBePublished,
  programCanGetWebsiteContent,
  programWebsiteMessage,
  restoreNameClash,
  sameGroupName,
  sortFeatured,
  type BatchPublicationRow,
} from "@/lib/domain/website-programs";
import { STALE_EDIT_MESSAGE } from "@/lib/domain/website";

describe("Program and Batch status rules (mirror the 22A functions)", () => {
  it("publishes only an active Program", () => {
    expect(programCanBePublished("active")).toBe(true);
    for (const s of ["draft", "inactive", "archived"]) {
      expect(programCanBePublished(s)).toBe(false);
    }
  });

  it("gives website content to any Program except an archived one", () => {
    expect(programCanGetWebsiteContent("draft")).toBe(true);
    expect(programCanGetWebsiteContent("archived")).toBe(false);
  });

  it("publishes only an upcoming or active Batch", () => {
    expect(batchCanBePublished("upcoming")).toBe(true);
    expect(batchCanBePublished("active")).toBe(true);
    for (const s of ["draft", "completed", "cancelled", "archived"]) {
      expect(batchCanBePublished(s)).toBe(false);
    }
  });
});

describe("published slugs (owner rule)", () => {
  it("locks the slug once a Program has ever been published, for everyone", () => {
    expect(isProgramSlugLocked(null)).toBe(false);
    expect(isProgramSlugLocked("2026-10-23T10:00:00Z")).toBe(true);
  });
});

describe("batchPublicationStatus", () => {
  const row = (o: Partial<BatchPublicationRow> = {}): BatchPublicationRow => ({
    draftLabel: "Weekend batch",
    draftState: "open",
    isPublished: false,
    publishedLabel: null,
    publishedState: null,
    firstPublishedAt: null,
    version: 1,
    ...o,
  });

  it("covers every state", () => {
    expect(batchPublicationStatus(null)).toBe("not_set_up");
    expect(batchPublicationStatus(row())).toBe("draft");
    const live = {
      isPublished: true,
      publishedLabel: "Weekend batch",
      publishedState: "open" as const,
      firstPublishedAt: "2026-10-23T10:00:00Z",
    };
    expect(batchPublicationStatus(row(live))).toBe("published");
    expect(batchPublicationStatus(row({ ...live, draftState: "full" }))).toBe(
      "published_with_changes",
    );
    expect(batchPublicationStatus(row({ ...live, draftLabel: "Changed" }))).toBe(
      "published_with_changes",
    );
    expect(
      batchPublicationStatus(row({ firstPublishedAt: "2026-10-23T10:00:00Z" })),
    ).toBe("unpublished");
    expect(BATCH_STATUS_LABELS.not_set_up).toBe("Not on the website");
  });
});

describe("ordering helpers", () => {
  it("moves one item up or down and refuses impossible moves", () => {
    expect(moveInList(["a", "b", "c"], 1, "up")).toEqual(["b", "a", "c"]);
    expect(moveInList(["a", "b", "c"], 1, "down")).toEqual(["a", "c", "b"]);
    expect(moveInList(["a", "b"], 0, "up")).toBeNull();
    expect(moveInList(["a", "b"], 1, "down")).toBeNull();
    expect(moveInList(["a"], -1, "down")).toBeNull();
  });

  it("sorts featured Programs by order, then name, with no order last", () => {
    const sorted = sortFeatured([
      { documentId: "x", featuredOrder: null, name: "Zeta" },
      { documentId: "y", featuredOrder: 2, name: "Beta" },
      { documentId: "z", featuredOrder: 2, name: "Alpha" },
      { documentId: "w", featuredOrder: 1, name: "Omega" },
    ]);
    expect(sorted.map((s) => s.documentId)).toEqual(["w", "z", "y", "x"]);
  });

  it("returns only the featured positions that change", () => {
    expect(
      featuredOrderChanges([
        { documentId: "b", featuredOrder: 2 },
        { documentId: "a", featuredOrder: 1 },
        { documentId: "c", featuredOrder: 3 },
      ]),
    ).toEqual([
      { documentId: "b", featuredOrder: 1 },
      { documentId: "a", featuredOrder: 2 },
    ]);
    // Gaps and missing orders are closed up.
    expect(
      featuredOrderChanges([
        { documentId: "a", featuredOrder: 5 },
        { documentId: "b", featuredOrder: null },
      ]),
    ).toEqual([
      { documentId: "a", featuredOrder: 1 },
      { documentId: "b", featuredOrder: 2 },
    ]);
  });

  it("puts a newly featured Program last, within the database limit", () => {
    expect(nextFeaturedOrder([])).toBe(1);
    expect(nextFeaturedOrder([3, null, 1])).toBe(4);
    expect(nextFeaturedOrder([10000])).toBe(10000);
  });
});

describe("programWebsiteMessage", () => {
  it("shows the database's own words for state, input, slug and duplicate problems", () => {
    expect(programWebsiteMessage("slug_unavailable", "That slug is already used")).toBe(
      "That slug is already used.",
    );
    expect(
      programWebsiteMessage("duplicate", "A display group with that name already exists"),
    ).toBe("A display group with that name already exists.");
    expect(programWebsiteMessage("invalid_state", "Choose an active display group")).toBe(
      "Choose an active display group.",
    );
  });

  it("uses fixed wording for refusals, stale edits and unknown errors", () => {
    expect(programWebsiteMessage("not_allowed", "secret detail")).toBe(
      "Only an active Admin or Super Admin can manage website content.",
    );
    expect(programWebsiteMessage("stale")).toBe(STALE_EDIT_MESSAGE);
    expect(programWebsiteMessage("unknown", "secret detail")).toBe(
      "Something went wrong. Please try again.",
    );
  });
});

describe("display group archive and restore rules", () => {
  it("compares group names like the database (trimmed, any case)", () => {
    expect(sameGroupName("Data and AI", "  data AND ai ")).toBe(true);
    expect(sameGroupName("Data and AI", "Data & AI")).toBe(false);
  });

  it("finds a restore name clash with an active group", () => {
    expect(restoreNameClash("Data and AI", ["Quality", "DATA AND AI"])).toBe(true);
    expect(restoreNameClash("Data and AI", ["Quality"])).toBe(false);
    expect(restoreNameClash("Data and AI", [])).toBe(false);
  });

  it("explains that Programs must be moved first, and that hiding is the alternative", () => {
    expect(GROUP_HAS_PROGRAMS_MESSAGE).toMatch(
      /Move its Programs to another group first/,
    );
    expect(GROUP_HAS_PROGRAMS_MESSAGE).toMatch(/hide the group instead/);
    expect(GROUP_RESTORE_NAME_TAKEN_MESSAGE).toMatch(
      /Rename or archive the active group first/,
    );
  });
});
