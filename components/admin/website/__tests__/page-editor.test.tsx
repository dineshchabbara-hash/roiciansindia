import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("@/lib/actions/website", () => ({
  saveWebsiteDraftAction: vi.fn(),
  publishWebsitePageAction: vi.fn(),
  unpublishWebsitePageAction: vi.fn(),
  restoreWebsiteRevisionAction: vi.fn(),
  createWebsitePageAction: vi.fn(),
}));

import { PageEditor, type EditorPage } from "@/components/admin/website/page-editor";
import {
  publishWebsitePageAction,
  saveWebsiteDraftAction,
  unpublishWebsitePageAction,
} from "@/lib/actions/website";
import type { WebsiteRevisionContent } from "@/lib/data/website";
import { STALE_EDIT_MESSAGE } from "@/lib/domain/website";
import { LEGAL_PUBLICATION_HELD_MESSAGE } from "@/lib/domain/website-admin";

const DOC = "aaaaaaaa-0000-4000-8000-000000000001";
const REV2 = "bbbbbbbb-0000-4000-8000-000000000002";

function editorPage(overrides: Partial<EditorPage> = {}): EditorPage {
  return {
    id: DOC,
    kind: "home",
    pageKey: "home",
    label: "Home",
    latestRevisionId: REV2,
    latestRevisionNumber: 2,
    publishedRevisionId: null,
    publishedRevisionNumber: null,
    firstPublishedAt: null,
    version: 4,
    ...overrides,
  };
}

const content: WebsiteRevisionContent = {
  id: REV2,
  number: 2,
  title: "Practical technology training for the AI era",
  summary: "Hands-on programs.",
  seoTitle: null,
  seoDescription: null,
  socialTitle: null,
  socialDescription: null,
  heroImageAssetId: null,
  socialImageAssetId: null,
  sections: [
    {
      key: "hero",
      type: "hero",
      visible: true,
      heading: "Build skills",
      cta: { label: "Explore", href: "/programs" },
    },
    {
      key: "faq",
      type: "faq",
      visible: true,
      heading: "FAQs",
      items: [{ question: "Is it online?", answer: "Yes." }],
    },
  ],
  createdAt: "2026-10-22T06:30:00Z",
  createdByName: "Asha Rao",
  restoredFromRevisionId: null,
};

function submittedDraft(call = 0) {
  const fd = vi.mocked(saveWebsiteDraftAction).mock.calls[call][1] as FormData;
  return { documentId: fd.get("documentId"), draft: JSON.parse(String(fd.get("draft"))) };
}

async function clickSave() {
  await act(async () => {
    fireEvent.click(screen.getAllByRole("button", { name: "Save draft" })[0]);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PageEditor", () => {
  it("pre-fills the latest saved content as structured fields", () => {
    render(<PageEditor page={editorPage()} content={content} />);
    const form = screen.getByRole("form", { name: "Edit Home" });
    expect(within(form).getByLabelText(/^Title/)).toHaveValue(
      "Practical technology training for the AI era",
    );
    expect(within(form).getByLabelText("Summary")).toHaveValue("Hands-on programs.");
    expect(within(form).getByRole("heading", { name: "1. Hero" })).toBeInTheDocument();
    expect(within(form).getByLabelText("Question")).toHaveValue("Is it online?");
    expect(within(form).getByLabelText("Button link")).toHaveValue("/programs");
    expect(form.querySelector("[contenteditable]")).toBeNull();
    for (const save of screen.getAllByRole("button", { name: "Save draft" })) {
      expect(save).toBeDisabled();
    }
  });

  it("saves the edited draft with the version it was based on", async () => {
    vi.mocked(saveWebsiteDraftAction).mockResolvedValue({
      message: "Draft saved as version 3. It is not public until you publish it.",
      saved: { revisionId: "r3", revisionNumber: 3 },
    });
    render(<PageEditor page={editorPage()} content={content} />);
    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: "New title" } });
    expect(screen.getByText("You have unsaved changes.")).toBeInTheDocument();
    await clickSave();
    await waitFor(() => expect(saveWebsiteDraftAction).toHaveBeenCalledTimes(1));
    const { documentId, draft } = submittedDraft();
    expect(documentId).toBe(DOC);
    expect(draft).toMatchObject({
      baseRevisionNumber: 2,
      title: "New title",
      summary: "Hands-on programs.",
    });
    expect(draft.sections).toHaveLength(2);
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Draft saved as version 3"),
    );
    expect(screen.getByText("Latest saved version: 3.")).toBeInTheDocument();
  });

  it("also saves from the bottom bar shown on phones and tablets", async () => {
    vi.mocked(saveWebsiteDraftAction).mockResolvedValue({
      saved: { revisionId: "r3", revisionNumber: 3 },
    });
    render(<PageEditor page={editorPage()} content={content} />);
    fireEvent.change(screen.getByLabelText(/^Title/), {
      target: { value: "From a phone" },
    });
    const [, bottomBar] = screen.getAllByRole("button", { name: "Save draft" });
    await act(async () => {
      fireEvent.click(bottomBar);
    });
    await waitFor(() => expect(saveWebsiteDraftAction).toHaveBeenCalledTimes(1));
    expect(submittedDraft().draft.title).toBe("From a phone");
    expect(await screen.findByText("Saved as version 3")).toBeInTheDocument();
  });

  it("keeps the user's text after a stale save and lets them save it deliberately", async () => {
    vi.mocked(saveWebsiteDraftAction)
      .mockResolvedValueOnce({
        error: STALE_EDIT_MESSAGE,
        stale: { latestRevisionNumber: 5 },
        attempt: 1,
      })
      .mockResolvedValueOnce({
        message: "Draft saved as version 6.",
        saved: { revisionId: "r6", revisionNumber: 6 },
      });
    render(<PageEditor page={editorPage()} content={content} />);
    fireEvent.change(screen.getByLabelText(/^Title/), {
      target: { value: "My careful edit" },
    });
    await clickSave();

    const alert = await screen.findByText(STALE_EDIT_MESSAGE);
    expect(alert.closest("[role=alert]")).toHaveTextContent("now version 5");
    expect(screen.getByLabelText(/^Title/)).toHaveValue("My careful edit");
    expect(
      screen.getByRole("link", { name: "Open the latest version in a new tab" }),
    ).toHaveAttribute("target", "_blank");

    fireEvent.click(screen.getByRole("button", { name: "Save my version anyway…" }));
    expect(screen.getByText(/Version 5 stays in the history/)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Confirm: save my version" }));
    });
    await waitFor(() => expect(saveWebsiteDraftAction).toHaveBeenCalledTimes(2));
    expect(submittedDraft(1).draft).toMatchObject({
      baseRevisionNumber: 5,
      title: "My careful edit",
    });
  });

  it("shows field errors next to the fields", async () => {
    vi.mocked(saveWebsiteDraftAction).mockResolvedValue({
      error: "Check the highlighted fields.",
      fieldErrors: {
        title: ["Title is required."],
        "sections.0.cta.href": [
          "Links must be a site path (/…), an https:// URL, mailto: or tel:.",
        ],
      },
      attempt: 1,
    });
    render(<PageEditor page={editorPage()} content={content} />);
    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: "" } });
    await clickSave();
    await screen.findByText("Check the highlighted fields.");
    expect(screen.getByLabelText(/^Title/)).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Button link")).toHaveAccessibleDescription(
      expect.stringContaining("Links must be a site path"),
    );
  });

  it("adds, hides, reorders and removes sections, leaving out blank rows", async () => {
    vi.mocked(saveWebsiteDraftAction).mockResolvedValue({
      saved: { revisionId: "r3", revisionNumber: 3 },
    });
    render(<PageEditor page={editorPage()} content={content} />);
    fireEvent.change(screen.getByLabelText("Add a section"), {
      target: { value: "faq" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add section" }));
    expect(screen.getByRole("heading", { name: "3. FAQ" })).toBeInTheDocument();
    expect(screen.getByText("Key: faq-2")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Move section 3 up" }));
    fireEvent.click(
      within(screen.getByRole("listitem", { name: "1. Hero" })).getByRole("checkbox"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove section 3" }));
    await clickSave();
    await waitFor(() => expect(saveWebsiteDraftAction).toHaveBeenCalled());
    const { sections } = submittedDraft().draft;
    expect(sections.map((s: { key: string }) => s.key)).toEqual(["hero", "faq-2"]);
    expect(sections[0].visible).toBe(false);
    expect(sections[1]).toEqual({ key: "faq-2", type: "faq", visible: true });
  });

  it("only offers section types the page supports", () => {
    render(
      <PageEditor
        page={editorPage({
          kind: "navigation",
          pageKey: "navigation",
          label: "Navigation menu",
          latestRevisionId: null,
          latestRevisionNumber: 0,
        })}
        content={null}
      />,
    );
    const options = within(screen.getByLabelText("Add a section")).getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["Menu"]);
    expect(screen.getByText("Nothing saved yet.")).toBeInTheDocument();
  });
});

describe("PublicationPanel (within the editor)", () => {
  it("requires a saved draft and no unsaved changes before publishing", () => {
    const { rerender } = render(
      <PageEditor
        page={editorPage({ latestRevisionId: null, latestRevisionNumber: 0 })}
        content={null}
      />,
    );
    expect(screen.getByRole("button", { name: "Publish…" })).toBeDisabled();
    expect(screen.getByText("Save a draft before publishing.")).toBeInTheDocument();

    rerender(<PageEditor key="b" page={editorPage()} content={content} />);
    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: "Edited" } });
    expect(screen.getByRole("button", { name: "Publish…" })).toBeDisabled();
    expect(screen.getByText("Save your changes before publishing.")).toBeInTheDocument();
  });

  it("publishes the latest saved version after confirmation", async () => {
    vi.mocked(publishWebsitePageAction).mockResolvedValue({
      message: "Published. This version is now the live content for this page.",
    });
    render(<PageEditor page={editorPage()} content={content} />);
    fireEvent.click(screen.getByRole("button", { name: "Publish…" }));
    expect(screen.getByText(/Publish version 2\?/)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Confirm publish" }));
    });
    await waitFor(() => expect(publishWebsitePageAction).toHaveBeenCalled());
    const fd = vi.mocked(publishWebsitePageAction).mock.calls[0][1] as FormData;
    expect(fd.get("documentId")).toBe(DOC);
    expect(fd.get("revisionId")).toBe(REV2);
    expect(await screen.findByText(/now the live content/)).toBeInTheDocument();
  });

  it("holds legal pages: Publish stays disabled with the reason shown", () => {
    render(
      <PageEditor
        page={editorPage({
          kind: "legal",
          pageKey: "privacy-policy",
          label: "Legal page: privacy-policy",
        })}
        content={{ ...content, sections: [] }}
      />,
    );
    const publish = screen.getByRole("button", { name: "Publish…" });
    expect(publish).toBeDisabled();
    expect(publish).toHaveAccessibleDescription(LEGAL_PUBLICATION_HELD_MESSAGE);
    expect(screen.getByText(LEGAL_PUBLICATION_HELD_MESSAGE)).toBeInTheDocument();
    expect(publishWebsitePageAction).not.toHaveBeenCalled();
  });

  it("unpublishes a live page with the document version after confirmation", async () => {
    vi.mocked(unpublishWebsitePageAction).mockResolvedValue({ message: "Unpublished." });
    render(
      <PageEditor
        page={editorPage({
          publishedRevisionId: REV2,
          publishedRevisionNumber: 2,
          firstPublishedAt: "x",
        })}
        content={content}
      />,
    );
    expect(screen.getByText("Live version: 2.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish…" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Unpublish…" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Confirm unpublish" }));
    });
    await waitFor(() => expect(unpublishWebsitePageAction).toHaveBeenCalled());
    const fd = vi.mocked(unpublishWebsitePageAction).mock.calls[0][1] as FormData;
    expect(fd.get("expectedVersion")).toBe("4");
  });

  it("links to the preview and history", () => {
    render(<PageEditor page={editorPage()} content={content} />);
    expect(
      screen.getByRole("link", { name: "Preview latest saved version" }),
    ).toHaveAttribute("href", `/admin/website/pages/${DOC}/preview`);
    expect(screen.getByRole("link", { name: "Version history" })).toHaveAttribute(
      "href",
      `/admin/website/pages/${DOC}/history`,
    );
  });
});
