import { describe, expect, it } from "vitest";
import {
  ADMIN_PAGE_KINDS,
  APPROVED_LEGAL_PAGE_KEYS,
  DEFAULT_PAGE_KEYS,
  LEGAL_PUBLICATION_HELD_MESSAGE,
  PAGE_KIND_LABELS,
  SECTION_FIELDS,
  SECTION_TYPE_LABELS,
  bodyParagraphs,
  cleanSectionForSave,
  formatWebsiteTimestamp,
  isAdminPageKind,
  isPublicationHeld,
  itemFieldsToShow,
  legalPageKeyProblem,
  nextSectionKey,
  websiteActionMessage,
  websitePageStatus,
} from "@/lib/domain/website-admin";
import {
  SECTION_TYPES_BY_KIND,
  STALE_EDIT_MESSAGE,
  WEBSITE_DOCUMENT_KINDS,
  type WebsiteSectionType,
} from "@/lib/domain/website";

describe("page kinds", () => {
  it("covers every non-Program website kind exactly once", () => {
    const expected = WEBSITE_DOCUMENT_KINDS.filter((k) => k !== "program");
    expect([...ADMIN_PAGE_KINDS].sort()).toEqual([...expected].sort());
    expect(new Set(ADMIN_PAGE_KINDS).size).toBe(ADMIN_PAGE_KINDS.length);
  });

  it("never treats Program pages as 22B-1 pages", () => {
    expect(isAdminPageKind("program")).toBe(false);
    expect(isAdminPageKind("home")).toBe(true);
    expect(isAdminPageKind("anything")).toBe(false);
  });

  it("labels every kind and gives each one-per-site page a valid, unique key", () => {
    for (const kind of ADMIN_PAGE_KINDS) expect(PAGE_KIND_LABELS[kind]).toBeTruthy();
    const keys = Object.values(DEFAULT_PAGE_KEYS);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) expect(key).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });
});

describe("legalPageKeyProblem", () => {
  it.each(["privacy-policy", "terms-of-use", "cookies"])("accepts %s", (key) => {
    expect(legalPageKeyProblem(key)).toBeNull();
  });

  it.each([
    ["a", /2–100/],
    ["Privacy", /lowercase/],
    ["privacy--policy", /single hyphens/],
    ["-privacy", /lowercase/],
    ["home", /reserved/],
    ["programs", /reserved/],
    ["program-123", /Program pages/],
  ])("refuses %s", (key, message) => {
    expect(legalPageKeyProblem(key)).toMatch(message);
  });
});

describe("websitePageStatus", () => {
  const base = {
    latestRevisionId: "r2",
    publishedRevisionId: null,
    firstPublishedAt: null,
  };

  it.each([
    [null, "not_created"],
    [{ ...base, latestRevisionId: null }, "empty"],
    [base, "draft"],
    [{ ...base, firstPublishedAt: "2026-10-01T00:00:00Z" }, "unpublished"],
    [{ ...base, publishedRevisionId: "r2", firstPublishedAt: "x" }, "published"],
    [
      { ...base, publishedRevisionId: "r1", firstPublishedAt: "x" },
      "published_with_changes",
    ],
  ] as const)("%j is %s", (doc, status) => {
    expect(websitePageStatus(doc)).toBe(status);
  });
});

describe("legal publishing hold (C4)", () => {
  it("holds every legal page while no wording is approved", () => {
    expect(APPROVED_LEGAL_PAGE_KEYS.size).toBe(0);
    expect(isPublicationHeld({ kind: "legal", pageKey: "privacy-policy" })).toBe(true);
    expect(isPublicationHeld({ kind: "legal", pageKey: "terms-of-use" })).toBe(true);
  });

  it("never holds other page types", () => {
    for (const kind of ADMIN_PAGE_KINDS.filter((k) => k !== "legal")) {
      expect(isPublicationHeld({ kind, pageKey: DEFAULT_PAGE_KEYS[kind] })).toBe(false);
    }
  });

  it("explains that drafting continues", () => {
    expect(LEGAL_PUBLICATION_HELD_MESSAGE).toMatch(/business and legal approval/);
    expect(LEGAL_PUBLICATION_HELD_MESSAGE).toMatch(/keep drafting/);
  });
});

describe("websiteActionMessage", () => {
  it("uses the shared stale-edit message", () => {
    expect(websiteActionMessage("stale", "raw database text")).toBe(STALE_EDIT_MESSAGE);
  });

  it("passes readable rule messages through with a full stop", () => {
    expect(
      websiteActionMessage("invalid_state", "This version is already published"),
    ).toBe("This version is already published.");
    expect(websiteActionMessage("invalid_input", "Title is required.")).toBe(
      "Title is required.",
    );
  });

  it("never shows raw text for unknown failures", () => {
    expect(websiteActionMessage("unknown", "relation does not exist")).toBe(
      "Something went wrong. Please try again.",
    );
    expect(websiteActionMessage("not_allowed")).toMatch(/active Admin or Super Admin/);
    expect(websiteActionMessage("duplicate")).toBe("That page already exists.");
  });
});

describe("section editor helpers", () => {
  it("labels and specifies every section type the database allows", () => {
    const types = new Set(Object.values(SECTION_TYPES_BY_KIND).flat());
    for (const type of types) {
      expect(SECTION_TYPE_LABELS[type as WebsiteSectionType]).toBeTruthy();
      expect(SECTION_FIELDS[type as WebsiteSectionType]).toBeDefined();
    }
  });

  it("creates unique keys", () => {
    expect(nextSectionKey("faq", [])).toBe("faq");
    expect(nextSectionKey("faq", ["faq"])).toBe("faq-2");
    expect(nextSectionKey("faq", ["faq", "faq-2"])).toBe("faq-3");
    expect(nextSectionKey("program_showcase", [])).toBe("program-showcase");
  });

  it("leaves out blank optional text, blank calls to action and blank item rows", () => {
    expect(
      cleanSectionForSave({
        key: "faq",
        type: "faq",
        visible: true,
        heading: "  ",
        body: "",
        cta: { label: "", href: " " },
        items: [
          { question: "Q?", answer: "A." },
          { question: "", answer: "  " },
        ],
      }),
    ).toEqual({
      key: "faq",
      type: "faq",
      visible: true,
      items: [{ question: "Q?", answer: "A." }],
    });
  });

  it("keeps partly filled fields so validation can explain them", () => {
    const cleaned = cleanSectionForSave({
      key: "hero",
      type: "hero",
      visible: false,
      heading: "Learn",
      cta: { label: "Explore", href: "" },
      imageAssetId: "11111111-1111-4111-8111-111111111111",
    });
    expect(cleaned.cta).toEqual({ label: "Explore", href: "" });
    expect(cleaned.visible).toBe(false);
    expect(cleaned.imageAssetId).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("shows a type's own item fields plus any field already used", () => {
    expect(itemFieldsToShow("faq", [])).toEqual(["question", "answer"]);
    expect(itemFieldsToShow("faq", [{ question: "Q", href: "/x" }])).toEqual([
      "question",
      "answer",
      "href",
    ]);
  });

  it("splits body text into paragraphs", () => {
    expect(bodyParagraphs("One\n\nTwo\n \nThree")).toEqual(["One", "Two", "Three"]);
    expect(bodyParagraphs(undefined)).toEqual([]);
  });

  it("formats timestamps in India time", () => {
    expect(formatWebsiteTimestamp("2026-10-22T06:30:00Z")).toMatch(
      /22 Oct 2026.*12:00.*IST/i,
    );
    expect(formatWebsiteTimestamp(null)).toBe("—");
  });
});
