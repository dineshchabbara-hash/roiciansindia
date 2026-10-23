import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/lib/actions/website", () => ({
  createWebsitePageAction: vi.fn(),
  restoreWebsiteRevisionAction: vi.fn(),
  saveWebsiteDraftAction: vi.fn(),
  publishWebsitePageAction: vi.fn(),
  unpublishWebsitePageAction: vi.fn(),
}));

import { PageEditor, type EditorPage } from "@/components/admin/website/page-editor";
import { RevisionHistory } from "@/components/admin/website/revision-history";
import {
  publishWebsitePageAction,
  restoreWebsiteRevisionAction,
  saveWebsiteDraftAction,
} from "@/lib/actions/website";
import { PROGRAM_NOT_ACTIVE_MESSAGE } from "@/lib/domain/website-programs";

/**
 * Phase 22B-2 reuses the 22B-1 editor and history with Program actions and
 * paths. These tests prove the Program bindings are used (and the 22B-1
 * page actions are not), and that the 22B-1 defaults are unchanged.
 */

const DOC = "aaaaaaaa-0000-4000-8000-000000000001";
const BASE = `/admin/website/programs/${DOC}`;

const programPage: EditorPage = {
  id: DOC,
  kind: "program",
  pageKey: "program-x",
  label: "Software Testing",
  latestRevisionId: "r1",
  latestRevisionNumber: 1,
  publishedRevisionId: null,
  publishedRevisionNumber: null,
  firstPublishedAt: null,
  version: 4,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PageEditor with Program bindings", () => {
  it("saves through the Program action and offers only Program section types", async () => {
    const save = vi
      .fn()
      .mockResolvedValue({ saved: { revisionId: "r2", revisionNumber: 2 } });
    render(
      <PageEditor
        page={programPage}
        content={null}
        bindings={{
          save,
          publish: vi.fn(),
          unpublish: vi.fn(),
          basePath: BASE,
          subject: "Program",
        }}
      />,
    );
    const options = Array.from(
      (screen.getByLabelText("Add a section") as HTMLSelectElement).options,
    ).map((o) => o.value);
    expect(options).toEqual(["text", "list", "faq", "cta"]);

    fireEvent.change(screen.getByLabelText(/^Headline|^Title/), {
      target: { value: "Software Testing Pro" },
    });
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "Save draft" })[0]);
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(saveWebsiteDraftAction).not.toHaveBeenCalled();
  });

  it("links preview and history below the Program path", () => {
    render(
      <PageEditor
        page={programPage}
        content={null}
        bindings={{ save: vi.fn(), basePath: BASE, subject: "Program" }}
      />,
    );
    expect(screen.getByRole("link", { name: "Version history" })).toHaveAttribute(
      "href",
      `${BASE}/history`,
    );
    expect(
      screen.getByRole("link", { name: "Preview latest saved version" }),
    ).toHaveAttribute("href", `${BASE}/preview`);
  });

  it("holds publishing with the given reason (Program not active in the LMS)", () => {
    render(
      <PageEditor
        page={programPage}
        content={null}
        bindings={{
          save: vi.fn(),
          basePath: BASE,
          publishHeldReason: PROGRAM_NOT_ACTIVE_MESSAGE,
          subject: "Program",
        }}
      />,
    );
    expect(screen.getByRole("button", { name: "Publish…" })).toBeDisabled();
    expect(screen.getByText(PROGRAM_NOT_ACTIVE_MESSAGE)).toBeInTheDocument();
  });

  it("publishes through the Program action with Program wording", async () => {
    const publish = vi.fn().mockResolvedValue({ message: "Published." });
    render(
      <PageEditor
        page={programPage}
        content={null}
        bindings={{
          save: vi.fn(),
          publish,
          basePath: BASE,
          publishHeldReason: null,
          subject: "Program",
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Publish…" }));
    expect(screen.getByText(/live content for this Program\./)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Confirm publish" }));
    });
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publishWebsitePageAction).not.toHaveBeenCalled();
  });
});

describe("RevisionHistory with Program bindings", () => {
  it("restores through the given action and previews below the Program path", async () => {
    const restore = vi.fn().mockResolvedValue({});
    render(
      <RevisionHistory
        documentId={DOC}
        latestRevisionNumber={2}
        restoreAction={restore}
        basePath={BASE}
        revisions={[
          {
            id: "r2",
            number: 2,
            title: "B",
            createdAt: "2026-10-23T10:00:00Z",
            createdByName: null,
            restoredFromNumber: null,
            isLatest: true,
            isPublished: false,
          },
          {
            id: "r1",
            number: 1,
            title: "A",
            createdAt: "2026-10-22T10:00:00Z",
            createdByName: null,
            restoredFromNumber: null,
            isLatest: false,
            isPublished: true,
          },
        ]}
      />,
    );
    expect(screen.getAllByRole("link", { name: "Preview" })[1]).toHaveAttribute(
      "href",
      `${BASE}/preview?revision=r1`,
    );
    fireEvent.click(screen.getByRole("button", { name: "Restore version 1" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Confirm restore" }));
    });
    expect(restore).toHaveBeenCalledTimes(1);
    expect(restoreWebsiteRevisionAction).not.toHaveBeenCalled();
  });
});
