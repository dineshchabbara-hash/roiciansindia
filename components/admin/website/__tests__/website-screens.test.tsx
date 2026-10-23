import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("@/lib/actions/website", () => ({
  createWebsitePageAction: vi.fn(),
  restoreWebsiteRevisionAction: vi.fn(),
  saveWebsiteDraftAction: vi.fn(),
  publishWebsitePageAction: vi.fn(),
  unpublishWebsitePageAction: vi.fn(),
}));

import {
  WebsitePagesTable,
  dashboardRows,
} from "@/components/admin/website/website-pages-table";
import { CreatePageForm } from "@/components/admin/website/create-page-form";
import { RevisionHistory } from "@/components/admin/website/revision-history";
import { PagePreview } from "@/components/admin/website/page-preview";
import {
  createWebsitePageAction,
  restoreWebsiteRevisionAction,
} from "@/lib/actions/website";
import type {
  WebsitePageSummary,
  WebsiteRevisionContent,
  WebsiteRevisionSummary,
} from "@/lib/data/website";

const DOC = "aaaaaaaa-0000-4000-8000-000000000001";

function summary(overrides: Partial<WebsitePageSummary> = {}): WebsitePageSummary {
  return {
    id: DOC,
    kind: "home",
    pageKey: "home",
    title: "Practical technology training",
    status: "published_with_changes",
    latestRevisionId: "r2",
    latestRevisionNumber: 2,
    publishedRevisionId: "r1",
    version: 4,
    updatedAt: "2026-10-22T06:30:00Z",
    updatedByName: "Asha Rao",
    publishedAt: "2026-10-21T06:30:00Z",
    publishedByName: null,
    firstPublishedAt: "2026-10-21T06:30:00Z",
    unpublishedAt: null,
    ...overrides,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("WebsitePagesTable", () => {
  it("lists every one-per-site page, created or not, and each legal page", () => {
    const rows = dashboardRows([
      summary(),
      summary({ id: "l2", kind: "legal", pageKey: "terms-of-use" }),
      summary({ id: "l1", kind: "legal", pageKey: "privacy-policy" }),
    ]);
    expect(rows.filter((r) => r.type === "missing")).toHaveLength(8);
    expect(
      rows
        .filter((r) => r.kind === "legal")
        .map((r) => (r.type === "page" ? r.page.pageKey : "")),
    ).toEqual(["privacy-policy", "terms-of-use"]);
  });

  it("shows status, editors and the legal hold", () => {
    render(
      <WebsitePagesTable
        pages={[
          summary(),
          summary({
            id: "l1",
            kind: "legal",
            pageKey: "privacy-policy",
            status: "draft",
            publishedAt: null,
          }),
        ]}
      />,
    );
    const home = screen.getByRole("row", { name: /^Home/ });
    expect(
      within(home).getByText("Published, with unpublished changes"),
    ).toBeInTheDocument();
    expect(within(home).getByText("Asha Rao")).toBeInTheDocument();
    expect(within(home).getByText("an admin")).toBeInTheDocument();
    expect(within(home).getByRole("link", { name: "Edit Home" })).toHaveAttribute(
      "href",
      `/admin/website/pages/${DOC}`,
    );
    const legal = screen.getByRole("row", { name: /privacy-policy/ });
    expect(
      within(legal).getByText("Publishing held: wording not yet approved"),
    ).toBeInTheDocument();
    const about = screen.getByRole("row", { name: /^About/ });
    expect(within(about).getByText("Not created")).toBeInTheDocument();
    expect(
      within(about).getByRole("button", { name: "Create About" }),
    ).toBeInTheDocument();
  });
});

describe("CreatePageForm", () => {
  it("submits a one-per-site page by type only", async () => {
    vi.mocked(createWebsitePageAction).mockResolvedValue({});
    render(<CreatePageForm kind="contact" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Create Contact" }));
    });
    await waitFor(() => expect(createWebsitePageAction).toHaveBeenCalled());
    const fd = vi.mocked(createWebsitePageAction).mock.calls[0][1] as FormData;
    expect(fd.get("kind")).toBe("contact");
    expect(fd.get("pageKey")).toBeNull();
  });

  it("asks for a legal page key and shows its error", async () => {
    vi.mocked(createWebsitePageAction).mockResolvedValue({
      error: "Check the page key.",
      fieldErrors: { pageKey: ["That key is reserved for another page."] },
    });
    render(<CreatePageForm kind="legal" />);
    fireEvent.change(screen.getByLabelText("New legal page key"), {
      target: { value: "home" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Create legal page" }));
    });
    expect(
      await screen.findByText("That key is reserved for another page."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("New legal page key")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });
});

describe("RevisionHistory", () => {
  const revisions: WebsiteRevisionSummary[] = [
    {
      id: "r3",
      number: 3,
      title: "T3",
      createdAt: "2026-10-22T06:30:00Z",
      createdByName: "Asha Rao",
      restoredFromNumber: 1,
      isLatest: true,
      isPublished: false,
    },
    {
      id: "r2",
      number: 2,
      title: "T2",
      createdAt: "2026-10-21T06:30:00Z",
      createdByName: null,
      restoredFromNumber: null,
      isLatest: false,
      isPublished: true,
    },
  ];

  it("labels live, latest and restored versions; never offers restoring the latest", () => {
    render(
      <RevisionHistory documentId={DOC} revisions={revisions} latestRevisionNumber={3} />,
    );
    const latest = screen.getByRole("row", { name: /Version 3/ });
    expect(within(latest).getByText("Latest draft")).toBeInTheDocument();
    expect(within(latest).getByText("Restored from version 1")).toBeInTheDocument();
    expect(within(latest).queryByRole("button", { name: /Restore/ })).toBeNull();
    const live = screen.getByRole("row", { name: /Version 2/ });
    expect(within(live).getByText("Live")).toBeInTheDocument();
    expect(within(live).getByRole("link", { name: "Preview" })).toHaveAttribute(
      "href",
      `/admin/website/pages/${DOC}/preview?revision=r2`,
    );
  });

  it("restores only after confirmation, based on the latest version number", async () => {
    vi.mocked(restoreWebsiteRevisionAction).mockResolvedValue({});
    render(
      <RevisionHistory documentId={DOC} revisions={revisions} latestRevisionNumber={3} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Restore version 2" }));
    expect(screen.getByText(/Copy version 2 into a new draft/)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Confirm restore" }));
    });
    await waitFor(() => expect(restoreWebsiteRevisionAction).toHaveBeenCalled());
    const fd = vi.mocked(restoreWebsiteRevisionAction).mock.calls[0][1] as FormData;
    expect(Object.fromEntries(fd.entries())).toEqual({
      documentId: DOC,
      sourceRevisionId: "r2",
      baseRevisionNumber: "3",
    });
  });

  it("explains an empty history", () => {
    render(<RevisionHistory documentId={DOC} revisions={[]} latestRevisionNumber={0} />);
    expect(screen.getByText("No versions have been saved yet.")).toBeInTheDocument();
  });
});

describe("PagePreview", () => {
  const content: WebsiteRevisionContent = {
    id: "r2",
    number: 2,
    title: "<b>Not bold</b>",
    summary: null,
    seoTitle: "Search title",
    seoDescription: null,
    socialTitle: null,
    socialDescription: null,
    heroImageAssetId: null,
    socialImageAssetId: null,
    sections: [
      {
        key: "intro",
        type: "text",
        visible: true,
        heading: "Intro",
        body: "First.\n\nSecond <script>alert(1)</script>",
      },
      {
        key: "old",
        type: "banner",
        visible: false,
        heading: "Old banner",
        cta: { label: "Go", href: "/x" },
      },
    ],
    createdAt: "2026-10-22T06:30:00Z",
    createdByName: null,
    restoredFromRevisionId: null,
  };

  it("renders content as text only, never as markup", () => {
    const { container } = render(<PagePreview content={content} isLive={false} />);
    expect(screen.getByRole("heading", { name: "<b>Not bold</b>" })).toBeInTheDocument();
    expect(container.querySelector("b, script")).toBeNull();
    expect(screen.getByText("Second <script>alert(1)</script>")).toBeInTheDocument();
    expect(screen.getByText("First.")).toBeInTheDocument();
  });

  it("marks hidden sections and does not render links", () => {
    const { container } = render(<PagePreview content={content} isLive />);
    expect(
      screen.getByRole("region", { name: "Banner section (hidden)" }),
    ).toHaveTextContent("Hidden: not shown on the website");
    expect(container.querySelector("a")).toBeNull();
    expect(screen.getByText("links to /x")).toBeInTheDocument();
    expect(screen.getByText(/This version is live/)).toBeInTheDocument();
    expect(screen.getAllByText("Search title")).toHaveLength(2);
  });
});
