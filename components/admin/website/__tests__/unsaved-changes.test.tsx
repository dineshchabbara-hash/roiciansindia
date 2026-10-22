import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/lib/actions/website", () => ({
  saveWebsiteDraftAction: vi.fn(),
  publishWebsitePageAction: vi.fn(),
  unpublishWebsitePageAction: vi.fn(),
  restoreWebsiteRevisionAction: vi.fn(),
  createWebsitePageAction: vi.fn(),
}));

import { PageEditor, type EditorPage } from "@/components/admin/website/page-editor";
import {
  UNSAVED_CHANGES_MESSAGE,
  draftStashKey,
  isSameTabNavigation,
  parseStash,
} from "@/components/admin/website/unsaved-changes";
import { saveWebsiteDraftAction } from "@/lib/actions/website";
import type { WebsiteRevisionContent } from "@/lib/data/website";

/**
 * Phase 22B-1 regression: unsaved editor content must not be discarded by
 * in-app (client-side) navigation without a warning. Before the fix only
 * `beforeunload` was handled, which Next.js links, the sidebar, Sign out and
 * Back/Forward never trigger.
 */

const USER = "11111111-0000-4000-8000-000000000001";
const DOC = "aaaaaaaa-0000-4000-8000-000000000001";
const REV2 = "bbbbbbbb-0000-4000-8000-000000000002";
const KEY = draftStashKey(USER, DOC);

const page: EditorPage = {
  id: DOC,
  kind: "about",
  pageKey: "about",
  label: "About",
  latestRevisionId: REV2,
  latestRevisionNumber: 2,
  publishedRevisionId: null,
  publishedRevisionNumber: null,
  firstPublishedAt: null,
  version: 3,
};

const content: WebsiteRevisionContent = {
  id: REV2,
  number: 2,
  title: "Saved title",
  summary: "Saved summary.",
  seoTitle: null,
  seoDescription: null,
  socialTitle: null,
  socialDescription: null,
  heroImageAssetId: null,
  socialImageAssetId: null,
  sections: [],
  createdAt: "2026-10-22T06:30:00Z",
  createdByName: null,
  restoredFromRevisionId: null,
};

const ORIGIN = window.location.origin;
let confirmSpy: ReturnType<typeof vi.spyOn>;
// Follows a link click like a browser would, without letting jsdom attempt a
// real navigation (which it does not implement). Returns whether the guard
// cancelled it: a cancelled click is stopped before it reaches this recorder.
let reached = false;
const recordLinkClick = (event: MouseEvent) => {
  if (!(event.target as Element).closest("a[href]")) return;
  reached = !event.defaultPrevented;
  event.preventDefault();
};
function clickLink(link: HTMLElement): "cancelled" | "allowed" {
  reached = false;
  fireEvent.click(link);
  return reached ? "allowed" : "cancelled";
}

function renderWithSurroundings() {
  return render(
    <div>
      <nav aria-label="Admin navigation">
        {/* A plain link stands in for the sidebar's Next.js link: the guard acts
            on the click before Next.js would, and jsdom has no app router. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/admin/students">Students</a>
        <a href="/admin/website/pages/x/history" target="_blank" rel="noreferrer">
          History in new tab
        </a>
        <a href="#main">Skip to content</a>
      </nav>
      <form aria-label="Sign out form" action="/logout">
        <button type="submit">Sign out</button>
      </form>
      <PageEditor page={page} content={content} stashOwnerId={USER} />
    </div>,
  );
}

function makeDirty(value = "Unsaved title") {
  fireEvent.change(screen.getByLabelText(/^Title/), { target: { value } });
}

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
  window.addEventListener("click", recordLinkClick);
});

afterEach(() => {
  window.removeEventListener("click", recordLinkClick);
  confirmSpy.mockRestore();
  vi.useRealTimers();
});

describe("isSameTabNavigation", () => {
  const current = new URL(`${ORIGIN}/admin/website/pages/${DOC}`);
  const click = {
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    defaultPrevented: false,
  };
  const link = (href: string, attrs: Record<string, string> = {}) => {
    const a = document.createElement("a");
    a.setAttribute("href", href);
    for (const [k, v] of Object.entries(attrs)) a.setAttribute(k, v);
    return a;
  };

  it("is true for an ordinary in-app link to another page", () => {
    expect(isSameTabNavigation(click, link("/admin/students"), current)).toBe(true);
    expect(
      isSameTabNavigation(click, link(`/admin/website/pages/${DOC}/history`), current),
    ).toBe(true);
    expect(
      isSameTabNavigation(click, link(`/admin/website/pages/${DOC}?x=1`), current),
    ).toBe(true);
  });

  it("is false for new tabs, downloads, modified clicks, other sites and the same page", () => {
    expect(isSameTabNavigation(click, link("/a", { target: "_blank" }), current)).toBe(
      false,
    );
    expect(isSameTabNavigation(click, link("/a", { download: "" }), current)).toBe(false);
    expect(isSameTabNavigation({ ...click, ctrlKey: true }, link("/a"), current)).toBe(
      false,
    );
    expect(isSameTabNavigation({ ...click, metaKey: true }, link("/a"), current)).toBe(
      false,
    );
    expect(isSameTabNavigation({ ...click, button: 1 }, link("/a"), current)).toBe(false);
    expect(
      isSameTabNavigation({ ...click, defaultPrevented: true }, link("/a"), current),
    ).toBe(false);
    expect(isSameTabNavigation(click, link("https://example.com/"), current)).toBe(false);
    expect(isSameTabNavigation(click, link("#faq"), current)).toBe(false);
  });
});

describe("parseStash", () => {
  it("accepts a well-formed copy and rejects anything else", () => {
    const good = { base: 2, savedAt: "2026-10-22T06:30:00Z", draft: { title: "x" } };
    expect(parseStash(JSON.stringify(good))).toEqual(good);
    expect(parseStash(null)).toBeNull();
    expect(parseStash("not json")).toBeNull();
    expect(parseStash(JSON.stringify({ base: "2", savedAt: "x", draft: {} }))).toBeNull();
    expect(parseStash(JSON.stringify({ base: 2, savedAt: "x", draft: null }))).toBeNull();
  });

  it("keys the copy to the signed-in user and the page", () => {
    expect(draftStashKey(USER, DOC)).toBe(`roicians.website.unsaved.${USER}.${DOC}`);
  });
});

describe("PageEditor unsaved-changes guard", () => {
  it("does not prompt while there are no unsaved changes", () => {
    renderWithSurroundings();
    expect(clickLink(screen.getByRole("link", { name: "Students" }))).toBe("allowed");
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("asks before a sidebar link discards unsaved changes; Cancel keeps the text", () => {
    renderWithSurroundings();
    makeDirty();
    expect(clickLink(screen.getByRole("link", { name: "Students" }))).toBe("cancelled");
    expect(confirmSpy).toHaveBeenCalledWith(UNSAVED_CHANGES_MESSAGE);
    expect(screen.getByLabelText(/^Title/)).toHaveValue("Unsaved title");
  });

  it("lets the user leave when they confirm", () => {
    confirmSpy.mockReturnValue(true);
    renderWithSurroundings();
    makeDirty();
    expect(clickLink(screen.getByRole("link", { name: "Students" }))).toBe("allowed");
    expect(confirmSpy).toHaveBeenCalledTimes(1);
  });

  it("guards the editor's Version history link; Preview opens a new tab and keeps the editor", () => {
    renderWithSurroundings();
    makeDirty();
    expect(clickLink(screen.getByRole("link", { name: "Version history" }))).toBe(
      "cancelled",
    );
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    confirmSpy.mockClear();
    const preview = screen.getByRole("link", { name: "Preview latest saved version" });
    expect(preview).toHaveAttribute("target", "_blank");
    expect(clickLink(preview)).toBe("allowed");
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/^Title/)).toHaveValue("Unsaved title");
  });

  it("does not prompt for a new-tab link or a link to a section of the same page", () => {
    renderWithSurroundings();
    makeDirty();
    expect(clickLink(screen.getByRole("link", { name: "History in new tab" }))).toBe(
      "allowed",
    );
    expect(clickLink(screen.getByRole("link", { name: "Skip to content" }))).toBe(
      "allowed",
    );
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("asks before a form outside the editor (Sign out) is submitted", () => {
    renderWithSurroundings();
    makeDirty();
    const submit = new Event("submit", { bubbles: true, cancelable: true });
    act(() => {
      screen.getByRole("form", { name: "Sign out form" }).dispatchEvent(submit);
    });
    expect(confirmSpy).toHaveBeenCalledWith(UNSAVED_CHANGES_MESSAGE);
    expect(submit.defaultPrevented).toBe(true);
  });

  it("does not prompt when the editor itself is saved", async () => {
    vi.mocked(saveWebsiteDraftAction).mockResolvedValue({
      saved: { revisionId: "r3", revisionNumber: 3 },
    });
    renderWithSurroundings();
    makeDirty();
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "Save draft" })[0]);
    });
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(saveWebsiteDraftAction).toHaveBeenCalledTimes(1);
  });

  describe("Back/Forward (browser Navigation API)", () => {
    const navigateEvent = (navigationType: string, cancelable = true) =>
      Object.assign(new Event("navigate", { cancelable }), { navigationType });
    let navigation: EventTarget;
    beforeEach(() => {
      navigation = new EventTarget();
      Object.defineProperty(window, "navigation", {
        value: navigation,
        configurable: true,
      });
    });
    afterEach(() => {
      Reflect.deleteProperty(window, "navigation");
    });

    it("asks before Back/Forward leaves the editor; Cancel stops it", () => {
      renderWithSurroundings();
      makeDirty();
      const back = navigateEvent("traverse");
      act(() => {
        navigation.dispatchEvent(back);
      });
      expect(confirmSpy).toHaveBeenCalledWith(UNSAVED_CHANGES_MESSAGE);
      expect(back.defaultPrevented).toBe(true);
      expect(screen.getByLabelText(/^Title/)).toHaveValue("Unsaved title");
    });

    it("lets Back/Forward go ahead when the user confirms", () => {
      confirmSpy.mockReturnValue(true);
      renderWithSurroundings();
      makeDirty();
      const back = navigateEvent("traverse");
      navigation.dispatchEvent(back);
      expect(confirmSpy).toHaveBeenCalledTimes(1);
      expect(back.defaultPrevented).toBe(false);
    });

    it("does not ask when clean, for non-history navigations, or when the browser forbids cancelling", () => {
      renderWithSurroundings();
      navigation.dispatchEvent(navigateEvent("traverse"));
      makeDirty();
      navigation.dispatchEvent(navigateEvent("push"));
      navigation.dispatchEvent(navigateEvent("traverse", false));
      expect(confirmSpy).not.toHaveBeenCalled();
    });
  });

  it("still warns before the tab is closed or reloaded", () => {
    renderWithSurroundings();
    makeDirty();
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("stops asking once the changes are saved", async () => {
    vi.mocked(saveWebsiteDraftAction).mockResolvedValue({
      saved: { revisionId: "r3", revisionNumber: 3 },
    });
    renderWithSurroundings();
    makeDirty();
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "Save draft" })[0]);
    });
    await screen.findByText("Latest saved version: 3.");
    expect(clickLink(screen.getByRole("link", { name: "Students" }))).toBe("allowed");
    expect(confirmSpy).not.toHaveBeenCalled();
  });
});

describe("PageEditor unsaved-draft safety copy", () => {
  it("keeps a copy of unsaved changes in this tab and removes it after saving", async () => {
    vi.useFakeTimers();
    vi.mocked(saveWebsiteDraftAction).mockResolvedValue({
      saved: { revisionId: "r3", revisionNumber: 3 },
    });
    renderWithSurroundings();
    makeDirty("Typed but not saved");
    act(() => {
      vi.advanceTimersByTime(500);
    });
    const stash = parseStash<{ title: string }>(window.sessionStorage.getItem(KEY));
    expect(stash).toMatchObject({ base: 2, draft: { title: "Typed but not saved" } });

    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "Save draft" })[0]);
    });
    vi.useRealTimers();
    await screen.findByText("Latest saved version: 3.");
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
  });

  it("offers to restore changes lost by leaving, keeping the original base version", async () => {
    window.sessionStorage.setItem(
      KEY,
      JSON.stringify({
        base: 2,
        savedAt: "2026-10-22T06:30:00Z",
        draft: {
          title: "Recovered title",
          summary: "",
          seoTitle: "",
          seoDescription: "",
          socialTitle: "",
          socialDescription: "",
          heroImageAssetId: null,
          socialImageAssetId: null,
          sections: [],
        },
      }),
    );
    vi.mocked(saveWebsiteDraftAction).mockResolvedValue({
      saved: { revisionId: "r3", revisionNumber: 3 },
    });
    render(
      <PageEditor
        page={{ ...page, latestRevisionNumber: 4 }}
        content={{ ...content, number: 4 }}
        stashOwnerId={USER}
      />,
    );
    const banner = screen.getByRole("alert");
    expect(banner).toHaveTextContent("Unsaved changes to this page were found");
    expect(banner).toHaveTextContent("started from version 2");
    expect(screen.getByLabelText(/^Title/)).toHaveValue("Saved title");

    fireEvent.click(screen.getByRole("button", { name: "Restore unsaved changes" }));
    expect(screen.getByLabelText(/^Title/)).toHaveValue("Recovered title");
    expect(screen.queryByRole("alert")).toBeNull();

    // Saving the restored text uses the version it started from, so the
    // database's stale-edit check still protects the newer version 4.
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "Save draft" })[0]);
    });
    const fd = vi.mocked(saveWebsiteDraftAction).mock.calls[0][1] as FormData;
    expect(JSON.parse(String(fd.get("draft")))).toMatchObject({
      baseRevisionNumber: 2,
      title: "Recovered title",
    });
  });

  it("lets the user discard a recovered copy", () => {
    window.sessionStorage.setItem(
      KEY,
      JSON.stringify({
        base: 2,
        savedAt: "2026-10-22T06:30:00Z",
        draft: { title: "Old", sections: [] },
      }),
    );
    render(<PageEditor page={page} content={content} stashOwnerId={USER} />);
    fireEvent.click(screen.getByRole("button", { name: "Discard them" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
    expect(screen.getByLabelText(/^Title/)).toHaveValue("Saved title");
  });

  it("shows no banner when the copy matches the saved content, or belongs to another user", () => {
    window.sessionStorage.setItem(
      draftStashKey("someone-else", DOC),
      JSON.stringify({
        base: 2,
        savedAt: "2026-10-22T06:30:00Z",
        draft: { title: "Theirs", sections: [] },
      }),
    );
    render(<PageEditor page={page} content={content} stashOwnerId={USER} />);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
