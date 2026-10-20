import { describe, expect, it } from "vitest";
import {
  batchPublicationSchema,
  deletionConfirmationMatches,
  displayGroupSchema,
  programDeletionRequestSchema,
  websiteDraftSchema,
  websiteSectionsSchema,
  websiteSlugSchema,
} from "@/lib/validation/website";

describe("website sections", () => {
  it("accepts structured Program content and defaults visibility", () => {
    const parsed = websiteSectionsSchema("program").parse([
      { key: "overview", type: "text", heading: "Overview", body: "Plain." },
      {
        key: "faq",
        type: "faq",
        visible: false,
        items: [{ question: "Who is it for?", answer: "Professionals." }],
      },
      {
        key: "cta",
        type: "cta",
        cta: { label: "Talk to an Advisor", href: "/contact" },
      },
    ]);
    expect(parsed[0].visible).toBe(true);
    expect(parsed[1].visible).toBe(false);
  });

  it.each([
    [[{ key: "a", type: "text", fee: "49999" }], "unknown field"],
    [[{ key: "a", type: "text", body: "<b>x</b>" }], "markup"],
    [[{ key: "a", type: "text", body: "₹49,999" }], "price"],
    [[{ key: "a", type: "menu" }], "type not allowed on a Program"],
    [
      [
        { key: "a", type: "text" },
        { key: "a", type: "faq" },
      ],
      "duplicate key",
    ],
    [[{ key: "Bad Key", type: "text" }], "bad key"],
    [
      [{ key: "a", type: "cta", cta: { label: "Go", href: "javascript:x" } }],
      "unsafe link",
    ],
    [[{ key: "a", type: "faq", items: [{ price: "1" }] }], "unknown item field"],
    [[{ key: "a", type: "faq", items: [{}] }], "empty item"],
  ] as [unknown, string][])("rejects %j (%s)", (sections) => {
    expect(websiteSectionsSchema("program").safeParse(sections).success).toBe(false);
  });

  it("allows menus only where supported", () => {
    const menu = [
      { key: "main", type: "menu", items: [{ label: "Programs", href: "/programs" }] },
    ];
    expect(websiteSectionsSchema("navigation").safeParse(menu).success).toBe(true);
    expect(websiteSectionsSchema("home").safeParse(menu).success).toBe(false);
  });
});

describe("website drafts", () => {
  it("requires a headline and a base revision number", () => {
    const schema = websiteDraftSchema("program");
    expect(
      schema.safeParse({ baseRevisionNumber: 0, title: "  ", sections: [] }).success,
    ).toBe(false);
    const ok = schema.parse({
      baseRevisionNumber: 2,
      title: "Data Analytics with AI",
      seoTitle: "",
      sections: [],
    });
    expect(ok.seoTitle).toBeNull();
    expect(ok.heroImageAssetId).toBeNull();
  });
  it("enforces SEO length limits", () => {
    expect(
      websiteDraftSchema("home").safeParse({
        baseRevisionNumber: 0,
        title: "Home",
        seoTitle: "x".repeat(71),
        sections: [],
      }).success,
    ).toBe(false);
  });
});

describe("other website forms", () => {
  it("validates slugs", () => {
    expect(websiteSlugSchema.safeParse("cloud-devops-engineering").success).toBe(true);
    expect(websiteSlugSchema.safeParse("Cloud DevOps").success).toBe(false);
  });
  it("validates display groups", () => {
    expect(
      displayGroupSchema.safeParse({
        name: "Career & Technology Programs",
        isVisible: true,
      }).success,
    ).toBe(true);
    expect(displayGroupSchema.safeParse({ name: "", isVisible: true }).success).toBe(
      false,
    );
  });
  it("allows only Open, Closed or Full for Batches", () => {
    expect(
      batchPublicationSchema.safeParse({
        publicLabel: "Weekend cohort",
        registrationState: "full",
      }).success,
    ).toBe(true);
    expect(
      batchPublicationSchema.safeParse({
        publicLabel: "Weekend cohort",
        registrationState: "coming_soon",
      }).success,
    ).toBe(false);
  });
});

describe("Program deletion request", () => {
  it("requires a reason and a typed code", () => {
    expect(
      programDeletionRequestSchema.safeParse({
        programId: "22a40000-0000-4000-8000-000000000010",
        confirmationCode: "P22A-SAFE",
        reason: "   ",
      }).success,
    ).toBe(false);
    expect(
      programDeletionRequestSchema.safeParse({
        programId: "22a40000-0000-4000-8000-000000000010",
        confirmationCode: "P22A-SAFE",
        reason: "Created in error",
      }).success,
    ).toBe(true);
  });
  it("matches the Program code exactly", () => {
    expect(deletionConfirmationMatches("P22A-SAFE", "P22A-SAFE")).toBe(true);
    expect(deletionConfirmationMatches("p22a-safe", "P22A-SAFE")).toBe(false);
    expect(deletionConfirmationMatches(" P22A-SAFE", "P22A-SAFE")).toBe(false);
  });
});

describe("Programs-listing and Upcoming-Batches page content", () => {
  const intro = [
    { key: "intro", type: "hero", heading: "Explore Programs" },
    {
      key: "faq",
      type: "faq",
      items: [{ question: "How do I choose?", answer: "Talk to an advisor." }],
    },
  ];
  it.each(["programs_listing", "upcoming_batches"] as const)(
    "accepts intro and FAQ sections on %s",
    (kind) => {
      expect(websiteSectionsSchema(kind).safeParse(intro).success).toBe(true);
    },
  );
  it.each(["programs_listing", "upcoming_batches"] as const)(
    "rejects showcase, menu and fee-like fields on %s",
    (kind) => {
      const schema = websiteSectionsSchema(kind);
      expect(schema.safeParse([{ key: "s", type: "program_showcase" }]).success).toBe(
        false,
      );
      expect(schema.safeParse([{ key: "m", type: "menu" }]).success).toBe(false);
      expect(schema.safeParse([{ key: "t", type: "text", fee: "1" }]).success).toBe(
        false,
      );
    },
  );
});
