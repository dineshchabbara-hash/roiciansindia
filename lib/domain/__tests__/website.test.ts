import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  SECTION_TYPES_BY_KIND,
  WEBSITE_DOCUMENT_KINDS,
  canChangeProgramSlug,
  containsMarkup,
  containsPrice,
  describeProgramDeletionBlocker,
  hasUnpublishedChanges,
  isSafeWebsiteHref,
  isValidWebsiteSlug,
  parseDeletionBlockerDetail,
  programDeletionBlockedMessage,
  suggestSlug,
  websiteErrorKind,
} from "@/lib/domain/website";

// The newest migration that (re)defines a rule is the one in force.
const MIGRATIONS_DIR = join(process.cwd(), "supabase/migrations");
function latestMigrationContaining(marker: string): string {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .reverse();
  for (const f of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, f), "utf8");
    if (sql.includes(marker)) return sql;
  }
  throw new Error(`no migration contains ${marker}`);
}
const SECTION_TYPES_SQL = latestMigrationContaining(
  "create or replace function website_allowed_section_types",
);
const KIND_CHECK_SQL = latestMigrationContaining(
  "constraint website_documents_kind check",
);

describe("section types stay in step with the database", () => {
  it("matches website_allowed_section_types() for every kind", () => {
    const body = SECTION_TYPES_SQL.slice(
      SECTION_TYPES_SQL.indexOf(
        "create or replace function website_allowed_section_types",
      ),
    );
    for (const kind of WEBSITE_DOCUMENT_KINDS) {
      const match = new RegExp(`when '${kind}' then array\\[([^\\]]*)\\]`).exec(body);
      expect(match, kind).not.toBeNull();
      const sqlTypes = match![1].split(",").map((t) => t.trim().replace(/'/g, ""));
      expect(SECTION_TYPES_BY_KIND[kind]).toEqual(sqlTypes);
    }
  });

  it("matches the website_documents kind check", () => {
    const check = KIND_CHECK_SQL.slice(
      KIND_CHECK_SQL.indexOf("constraint website_documents_kind check"),
    );
    const kinds = check
      .slice(check.indexOf("(kind in (") + 10, check.indexOf("))"))
      .split(",")
      .map((k) => k.trim().replace(/'/g, ""))
      .filter((k) => k.length > 0);
    expect([...kinds].sort()).toEqual([...WEBSITE_DOCUMENT_KINDS].sort());
  });
});

describe("slugs", () => {
  it("accepts lowercase hyphenated slugs of 3-100 characters", () => {
    expect(isValidWebsiteSlug("ai-powered-software-testing-qa")).toBe(true);
    expect(isValidWebsiteSlug("abc")).toBe(true);
  });
  it.each([
    "ab",
    "Bad-Slug",
    "double--hyphen",
    "-lead",
    "trail-",
    "with space",
    "a".repeat(101),
  ])("rejects %s", (slug) => {
    expect(isValidWebsiteSlug(slug)).toBe(false);
  });
  it("suggests a valid slug from a Program name", () => {
    expect(suggestSlug("AI-Powered Software Testing & QA")).toBe(
      "ai-powered-software-testing-and-qa",
    );
    expect(suggestSlug("Generative AI & LLMOps Engineering")).toBe(
      "generative-ai-and-llmops-engineering",
    );
    expect(isValidWebsiteSlug(suggestSlug("Data Analytics with AI"))).toBe(true);
  });
  it("lets Admins change a slug only before first publication", () => {
    expect(canChangeProgramSlug({ isSuperAdmin: false, firstPublishedAt: null })).toBe(
      true,
    );
    expect(
      canChangeProgramSlug({
        isSuperAdmin: false,
        firstPublishedAt: "2026-10-01T00:00:00Z",
      }),
    ).toBe(false);
    expect(
      canChangeProgramSlug({
        isSuperAdmin: true,
        firstPublishedAt: "2026-10-01T00:00:00Z",
      }),
    ).toBe(true);
  });
});

describe("content safety", () => {
  it("detects markup but allows ordinary comparisons", () => {
    expect(containsMarkup("<script>x</script>")).toBe(true);
    expect(containsMarkup("</p>")).toBe(true);
    expect(containsMarkup("<!-- c -->")).toBe(true);
    expect(containsMarkup("Teams of <5 people")).toBe(false);
  });
  it("detects prices (P22-09)", () => {
    expect(containsPrice("Only ₹49,999")).toBe(true);
    expect(containsPrice("Talk to an Advisor")).toBe(false);
  });
  it.each([
    "/contact",
    "/programs/data-analytics-with-ai?ref=home#top",
    "https://www.roicians.com/",
    "mailto:info@example.com",
    "tel:+91 98765 43210",
  ])("allows %s", (href) => {
    expect(isSafeWebsiteHref(href)).toBe(true);
  });
  it.each([
    "javascript:alert(1)",
    "//evil.example",
    "http://insecure.example",
    "data:text/html;base64,xx",
    "/path with space",
    '/x"onmouseover="y',
    "",
  ])("refuses %s", (href) => {
    expect(isSafeWebsiteHref(href)).toBe(false);
  });
});

describe("publication state", () => {
  it("reports unpublished changes", () => {
    expect(
      hasUnpublishedChanges({
        latest_revision_id: "a",
        published_revision_id: "a",
      }),
    ).toBe(false);
    expect(
      hasUnpublishedChanges({
        latest_revision_id: "b",
        published_revision_id: "a",
      }),
    ).toBe(true);
    expect(
      hasUnpublishedChanges({
        latest_revision_id: null,
        published_revision_id: null,
      }),
    ).toBe(false);
  });
  it("maps database error codes", () => {
    expect(websiteErrorKind("P2203")).toBe("stale");
    expect(websiteErrorKind("P2201")).toBe("deletion_blocked");
    expect(websiteErrorKind("42501")).toBe("not_allowed");
    expect(websiteErrorKind("XX000")).toBe("unknown");
    expect(websiteErrorKind(null)).toBe("unknown");
  });
});

describe("Program deletion explanations (§7.4)", () => {
  it("parses the P2201 detail", () => {
    expect(
      parseDeletionBlockerDetail("dependency:batches, dependency:enrollments"),
    ).toEqual(["dependency:batches", "dependency:enrollments"]);
    expect(parseDeletionBlockerDetail(null)).toEqual([]);
  });
  it("produces the approved wording with the archive alternative", () => {
    expect(
      programDeletionBlockedMessage(["dependency:batches", "dependency:enrollments"]),
    ).toBe(
      "This Program cannot be permanently deleted because it has linked Batches and enrollments. It can remain archived, and its historical records will be preserved.",
    );
  });
  it("explains an unarchived Program", () => {
    expect(programDeletionBlockedMessage(["not_archived"])).toBe(
      "This Program cannot be permanently deleted because it is not archived. It can remain archived, and its historical records will be preserved.",
    );
  });
  it("describes every blocker the database can return", () => {
    for (const code of [
      "not_found",
      "not_archived",
      "uncertain_dependency",
      "stored_file_reference",
      "stored_files",
      "website_published_history",
      "website_link_reference",
      "audit_history",
      "unattributable_history",
      "dependency:website_documents",
      "dependency:some_future_table",
    ]) {
      expect(describeProgramDeletionBlocker(code)).not.toBe("");
    }
    expect(describeProgramDeletionBlocker("dependency:some_future_table")).toBe(
      "linked some future table",
    );
  });
});

describe("Phase 22A corrections", () => {
  it("includes the Programs-listing and Upcoming-Batches page kinds as single pages", async () => {
    const { SINGLETON_DOCUMENT_KINDS } = await import("@/lib/domain/website");
    for (const kind of ["programs_listing", "upcoming_batches"] as const) {
      expect(WEBSITE_DOCUMENT_KINDS).toContain(kind);
      expect(SINGLETON_DOCUMENT_KINDS).toContain(kind);
      expect(SECTION_TYPES_BY_KIND[kind]).not.toContain("program_showcase");
      expect(SECTION_TYPES_BY_KIND[kind]).toContain("faq");
    }
  });

  it("explains unattributable history without offering an override", () => {
    const message = programDeletionBlockedMessage(["unattributable_history"]);
    expect(message).toContain("can no longer be linked to any Program");
    expect(message).toContain("can remain archived");
    expect(message.toLowerCase()).not.toContain("anyway");
  });
});
