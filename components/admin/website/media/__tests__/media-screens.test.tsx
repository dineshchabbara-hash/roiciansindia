import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/lib/actions/website-media", () => ({
  prepareMediaUploadAction: vi.fn(),
  completeMediaUploadAction: vi.fn(),
  saveMediaAltTextAction: vi.fn(),
  changeMediaStatusAction: vi.fn(),
  removeIncompleteUploadsAction: vi.fn(),
}));
vi.mock("@/lib/website-media-upload", () => ({ uploadToSignedMediaUrl: vi.fn() }));
vi.mock("@/lib/actions/website", () => ({
  createWebsitePageAction: vi.fn(),
  restoreWebsiteRevisionAction: vi.fn(),
  saveWebsiteDraftAction: vi.fn(),
  publishWebsitePageAction: vi.fn(),
  unpublishWebsitePageAction: vi.fn(),
}));

import { IncompleteUploads } from "@/components/admin/website/media/incomplete-uploads";
import { MediaDetail } from "@/components/admin/website/media/media-detail";
import {
  MediaFilterNav,
  MediaLibrary,
} from "@/components/admin/website/media/media-library";
import { MediaPicker } from "@/components/admin/website/media/media-picker";
import { MediaUploader } from "@/components/admin/website/media/media-uploader";
import { PageEditor, type EditorPage } from "@/components/admin/website/page-editor";
import { PagePreview } from "@/components/admin/website/page-preview";
import * as actions from "@/lib/actions/website-media";
import type { WebsiteRevisionContent } from "@/lib/data/website";
import type { EditorMedia, MediaAsset, MediaOption } from "@/lib/data/website-media";
import { UNAPPROVED_IMAGES_MESSAGE } from "@/lib/domain/website-media";
import { PNG_3x2, bytes } from "@/lib/domain/__tests__/fixtures/sample-images";
import { uploadToSignedMediaUrl } from "@/lib/website-media-upload";

const A1 = "aaaaaaaa-0000-4000-8000-000000000001";
const A2 = "aaaaaaaa-0000-4000-8000-000000000002";
const A3 = "aaaaaaaa-0000-4000-8000-000000000003";
const DOC = "dddddddd-0000-4000-8000-000000000001";

function asset(overrides: Partial<MediaAsset> = {}): MediaAsset {
  return {
    id: A1,
    path: `0f0e0d0c-0b0a-4908-8706-050403020100/classroom.png`,
    fileName: "classroom.png",
    mimeType: "image/png",
    byteSize: 20480,
    width: 1600,
    height: 900,
    altText: "Learners in a classroom (sample)",
    status: "draft",
    version: 2,
    createdAt: "2026-10-23T10:00:00Z",
    createdByName: "Asha Rao",
    approvedAt: null,
    approvedByName: null,
    updatedAt: "2026-10-23T10:00:00Z",
    previewUrl: "https://signed.example/classroom",
    ...overrides,
  };
}

function option(overrides: Partial<MediaOption> = {}): MediaOption {
  return {
    id: A1,
    fileName: "classroom.png",
    altText: "Learners in a classroom (sample)",
    status: "approved",
    width: 1600,
    height: 900,
    previewUrl: "https://signed.example/classroom",
    ...overrides,
  };
}

function submitted(fn: unknown, call = 0): FormData {
  return vi.mocked(fn as (...a: unknown[]) => unknown).mock.calls[call][1] as FormData;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("MediaLibrary", () => {
  it("shows each image with status, alt text, details and a private preview", () => {
    render(
      <MediaLibrary
        filter="all"
        assets={[
          asset(),
          asset({
            id: A2,
            fileName: "team.webp",
            mimeType: "image/webp",
            altText: null,
            status: "approved",
          }),
        ]}
      />,
    );
    const cards = within(screen.getByRole("list", { name: "Images" })).getAllByRole(
      "listitem",
    );
    expect(cards[0]).toHaveTextContent("classroom.png");
    expect(cards[0]).toHaveTextContent("Draft");
    expect(cards[0]).toHaveTextContent("PNG · 1600 × 900 px · 20 KB");
    expect(cards[1]).toHaveTextContent("No alt text yet");
    const img = within(cards[0]).getByRole("img");
    expect(img).toHaveAttribute("src", "https://signed.example/classroom");
    expect(img).toHaveAttribute("referrerpolicy", "no-referrer");
    expect(screen.getByRole("link", { name: "Details for team.webp" })).toHaveAttribute(
      "href",
      `/admin/website/media/${A2}`,
    );
  });

  it("explains an empty library and marks the current filter", () => {
    render(<MediaLibrary filter="retired" assets={[]} />);
    expect(screen.getByText("No Retired images.")).toBeInTheDocument();
    render(<MediaFilterNav current="approved" />);
    expect(screen.getByRole("link", { name: "Approved" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "All" })).toHaveAttribute(
      "href",
      "/admin/website/media",
    );
  });
});

describe("MediaUploader", () => {
  const png = () =>
    new File([bytes(PNG_3x2)], "Classroom photo.png", { type: "image/png" });

  async function choose(file: File) {
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Image file"), {
        target: { files: [file] },
      });
    });
  }

  it("checks the chosen file's content before upload", async () => {
    render(<MediaUploader />);
    await choose(png());
    expect(await screen.findByText(/PNG · 3 × 2 px/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Upload image/ })).toBeEnabled();

    await choose(
      new File(["<html>not an image</html>"], "fake.png", { type: "image/png" }),
    );
    expect(await screen.findByText(/not a valid JPEG, PNG or WebP/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Upload image/ })).toBeDisabled();
  });

  it("prepares, uploads straight to storage, then has the server check and record it", async () => {
    vi.mocked(actions.prepareMediaUploadAction).mockResolvedValue({
      ok: true,
      path: "0f0e0d0c-0b0a-4908-8706-050403020100/Classroom-photo.png",
      token: "tok",
    });
    vi.mocked(uploadToSignedMediaUrl).mockResolvedValue({ ok: true });
    vi.mocked(actions.completeMediaUploadAction).mockResolvedValue({ ok: true, id: A1 });
    render(<MediaUploader />);
    await choose(png());
    fireEvent.change(screen.getByLabelText(/Alt text/), {
      target: { value: "Learners in a classroom (sample)" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Upload image/ }));
    });
    expect(actions.prepareMediaUploadAction).toHaveBeenCalledWith({
      fileName: "Classroom photo.png",
      byteSize: bytes(PNG_3x2).length,
      mimeType: "image/png",
      altText: "Learners in a classroom (sample)",
    });
    expect(uploadToSignedMediaUrl).toHaveBeenCalledWith(
      "0f0e0d0c-0b0a-4908-8706-050403020100/Classroom-photo.png",
      "tok",
      expect.any(File),
      "image/png",
    );
    expect(actions.completeMediaUploadAction).toHaveBeenCalledWith({
      path: "0f0e0d0c-0b0a-4908-8706-050403020100/Classroom-photo.png",
      altText: "Learners in a classroom (sample)",
    });
    expect(await screen.findByRole("status")).toHaveTextContent(/as a Draft/);
    expect(screen.getByRole("link", { name: "Open image details" })).toHaveAttribute(
      "href",
      `/admin/website/media/${A1}`,
    );
    expect(refresh).toHaveBeenCalled();
  });

  it("shows why an upload could not start, and uploads nothing", async () => {
    vi.mocked(actions.prepareMediaUploadAction).mockResolvedValue({
      ok: false,
      error:
        "Uploading is not enabled yet: the website media upload policy is awaiting approval. Nothing was uploaded.",
    });
    render(<MediaUploader />);
    await choose(png());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Upload image/ }));
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /Uploading is not enabled yet/,
    );
    expect(uploadToSignedMediaUrl).not.toHaveBeenCalled();
    expect(actions.completeMediaUploadAction).not.toHaveBeenCalled();
  });

  it("blocks upload while the alt text is unsuitable", async () => {
    render(<MediaUploader />);
    await choose(png());
    fireEvent.change(screen.getByLabelText(/Alt text/), {
      target: { value: "IMG_1234.png" },
    });
    expect(screen.getByText(/not repeat its file name/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Upload image/ })).toBeDisabled();
  });
});

describe("IncompleteUploads", () => {
  it("says when clean-up is not available yet", () => {
    render(<IncompleteUploads available={false} items={[]} />);
    expect(
      screen.getByText(/available once the website media upload policy is approved/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("lists abandoned files and removes them only after confirmation", async () => {
    vi.mocked(actions.removeIncompleteUploadsAction).mockResolvedValue({
      message: "Removed 1 incomplete upload.",
    });
    render(
      <IncompleteUploads
        available
        items={[
          {
            path: "0f0e0d0c-0b0a-4908-8706-050403020100/left-over.png",
            uploadedAt: "2026-10-20T09:00:00Z",
            byteSize: 512,
            uploadedByMe: true,
          },
        ]}
      />,
    );
    expect(screen.getByText(/left-over.png/)).toHaveTextContent("uploaded by you");
    fireEvent.click(screen.getByRole("button", { name: "Remove incomplete uploads…" }));
    expect(actions.removeIncompleteUploadsAction).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Confirm removal" }));
    });
    expect(actions.removeIncompleteUploadsAction).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Removed 1 incomplete upload.",
    );
  });
});

describe("MediaDetail", () => {
  it("approves only after confirmation, sending the version seen", async () => {
    vi.mocked(actions.changeMediaStatusAction).mockResolvedValue({
      message: "Image approved.",
      version: 3,
    });
    render(<MediaDetail asset={asset()} usage={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Approve…" }));
    expect(screen.getByText(/Approve this image\?/)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Confirm: approve" }));
    });
    const fd = submitted(actions.changeMediaStatusAction);
    expect(fd.get("change")).toBe("approve");
    expect(fd.get("expectedVersion")).toBe("2");
    expect(fd.get("assetId")).toBe(A1);
  });

  it("holds approval until the alt text is suitable", () => {
    render(<MediaDetail asset={asset({ altText: null })} usage={[]} />);
    const approve = screen.getByRole("button", { name: "Approve…" });
    expect(approve).toBeDisabled();
    expect(approve).toHaveAccessibleDescription(
      "Before approving: Add alt text that describes the image.",
    );
  });

  it("keeps a published image approved, and lists where it is used", () => {
    render(
      <MediaDetail
        asset={asset({
          status: "approved",
          approvedAt: "2026-10-23T11:00:00Z",
          approvedByName: "Asha Rao",
        })}
        usage={[
          {
            documentId: DOC,
            label: "About",
            href: `/admin/website/pages/${DOC}`,
            inPublished: true,
            inLatest: true,
            versionNumbers: [2, 3],
          },
        ]}
      />,
    );
    for (const name of ["Withdraw approval…", "Retire…"]) {
      const button = screen.getByRole("button", { name });
      expect(button).toBeDisabled();
      expect(button).toHaveAccessibleDescription(
        "Published content uses this image. Publish a version without it first.",
      );
    }
    expect(
      screen.getAllByText(
        "Published content uses this image. Publish a version without it first.",
      ),
    ).toHaveLength(1);
    const usage = screen.getByRole("link", { name: "About" }).closest("li")!;
    expect(usage).toHaveTextContent("Live");
    expect(usage).toHaveTextContent("Latest draft");
    expect(usage).toHaveTextContent("Versions 2, 3");
    expect(
      screen.getByText("Approved", { selector: "dt" }).nextElementSibling,
    ).toHaveTextContent(/by Asha Rao/);
  });

  it("restores a retired image without a confirmation step", async () => {
    vi.mocked(actions.changeMediaStatusAction).mockResolvedValue({
      message: "Image restored to Draft.",
    });
    render(<MediaDetail asset={asset({ status: "retired" })} usage={[]} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Restore to Draft" }));
    });
    expect(submitted(actions.changeMediaStatusAction).get("change")).toBe("restore");
  });

  it("saves alt text with the version seen", async () => {
    vi.mocked(actions.saveMediaAltTextAction).mockResolvedValue({
      message: "Alt text saved.",
      version: 3,
    });
    render(<MediaDetail asset={asset()} usage={[]} />);
    fireEvent.change(screen.getByLabelText("Alt text"), {
      target: { value: "Two learners at a laptop (sample)" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save alt text" }));
    });
    const fd = submitted(actions.saveMediaAltTextAction);
    expect(fd.get("altText")).toBe("Two learners at a laptop (sample)");
    expect(fd.get("expectedVersion")).toBe("2");
    expect(await screen.findByRole("status")).toHaveTextContent("Alt text saved.");
  });
});

describe("MediaDetail after a save refreshes the page", () => {
  it("keeps the alt text confirmation when the image's version changes", async () => {
    vi.mocked(actions.saveMediaAltTextAction).mockResolvedValue({
      message: "Alt text saved.",
      version: 3,
    });
    const { rerender } = render(<MediaDetail asset={asset()} usage={[]} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save alt text" }));
    });
    rerender(<MediaDetail asset={asset({ version: 3 })} usage={[]} />);
    expect(screen.getByRole("status")).toHaveTextContent("Alt text saved.");
  });
});

describe("MediaPicker", () => {
  const media: EditorMedia = {
    approved: [
      option(),
      option({ id: A2, fileName: "team.webp", altText: "Trainer with a group (sample)" }),
    ],
    chosen: {
      [A3]: option({
        id: A3,
        fileName: "old.png",
        status: "retired",
        altText: "Old banner",
      }),
    },
  };

  it("offers only Approved images and reports the choice", () => {
    const onChange = vi.fn();
    render(
      <MediaPicker label="Main image" value={null} media={media} onChange={onChange} />,
    );
    expect(screen.getByText("No image chosen.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Choose main image" }));
    expect(screen.queryByRole("button", { name: "Use image: Old banner" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Search Approved images"), {
      target: { value: "trainer" },
    });
    expect(screen.queryByRole("button", { name: /Learners in a classroom/ })).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Use image: Trainer with a group (sample)" }),
    );
    expect(onChange).toHaveBeenCalledWith(A2);
  });

  it("flags a chosen image that is no longer Approved, and can remove it", () => {
    const onChange = vi.fn();
    render(
      <MediaPicker label="Main image" value={A3} media={media} onChange={onChange} />,
    );
    expect(screen.getByText(/This image is not Approved/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove main image" }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("points to Media when nothing is approved yet", () => {
    render(
      <MediaPicker
        label="Main image"
        value={null}
        media={{ approved: [], chosen: {} }}
        onChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Choose main image" }));
    expect(screen.getByRole("link", { name: "Media" })).toHaveAttribute(
      "href",
      "/admin/website/media",
    );
  });
});

describe("PageEditor with media", () => {
  const page = (kind: EditorPage["kind"]): EditorPage => ({
    id: DOC,
    kind,
    pageKey: kind,
    label: "Page",
    latestRevisionId: "r1",
    latestRevisionNumber: 1,
    publishedRevisionId: null,
    publishedRevisionNumber: null,
    firstPublishedAt: null,
    version: 2,
  });
  const content = (
    overrides: Partial<WebsiteRevisionContent> = {},
  ): WebsiteRevisionContent => ({
    id: "r1",
    number: 1,
    title: "About us",
    summary: null,
    seoTitle: null,
    seoDescription: null,
    socialTitle: null,
    socialDescription: null,
    heroImageAssetId: null,
    socialImageAssetId: null,
    sections: [{ key: "hero", type: "hero", visible: true, heading: "Welcome" }],
    createdAt: "2026-10-23T10:00:00Z",
    createdByName: null,
    restoredFromRevisionId: null,
    ...overrides,
  });

  it("offers main, social and section images where the page uses them", () => {
    render(
      <PageEditor
        page={page("about")}
        content={content()}
        media={{ approved: [option()], chosen: {} }}
      />,
    );
    expect(screen.getByRole("group", { name: "Main image" })).toBeInTheDocument();
    expect(
      screen.getByRole("group", { name: "Social sharing image" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Section image" })).toBeInTheDocument();
  });

  it("offers no page images for navigation", () => {
    render(
      <PageEditor
        page={page("navigation")}
        content={content({ sections: [] })}
        media={{ approved: [option()], chosen: {} }}
      />,
    );
    expect(screen.queryByRole("group", { name: "Main image" })).toBeNull();
  });

  it("holds publishing while a chosen image is not Approved", () => {
    render(
      <PageEditor
        page={page("about")}
        content={content({ heroImageAssetId: A3 })}
        media={{
          approved: [option()],
          chosen: { [A3]: option({ id: A3, status: "draft" }) },
        }}
      />,
    );
    expect(screen.getByRole("button", { name: "Publish…" })).toBeDisabled();
    expect(screen.getByText(UNAPPROVED_IMAGES_MESSAGE)).toBeInTheDocument();
  });

  it("saves a chosen image with the draft", async () => {
    const save = vi
      .fn()
      .mockResolvedValue({ saved: { revisionId: "r2", revisionNumber: 2 } });
    render(
      <PageEditor
        page={page("about")}
        content={content()}
        media={{ approved: [option()], chosen: {} }}
        bindings={{ save }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Choose main image" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Use image: Learners in a classroom (sample)" }),
    );
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "Save draft" })[0]);
    });
    await waitFor(() => expect(save).toHaveBeenCalled());
    const draft = JSON.parse(String((save.mock.calls[0][1] as FormData).get("draft")));
    expect(draft.heroImageAssetId).toBe(A1);
  });
});

describe("PagePreview with media", () => {
  it("shows chosen images with alt text and flags unapproved ones", () => {
    render(
      <PagePreview
        isLive={false}
        content={{
          id: "r1",
          number: 1,
          title: "About us",
          summary: null,
          seoTitle: null,
          seoDescription: null,
          socialTitle: null,
          socialDescription: null,
          heroImageAssetId: A1,
          socialImageAssetId: null,
          sections: [{ key: "banner", type: "banner", visible: true, imageAssetId: A3 }],
          createdAt: "2026-10-23T10:00:00Z",
          createdByName: null,
          restoredFromRevisionId: null,
        }}
        media={{
          [A1]: option(),
          [A3]: option({ id: A3, status: "draft", altText: "Draft banner" }),
        }}
      />,
    );
    expect(
      screen.getByRole("img", { name: "Learners in a classroom (sample)" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Alt text: Draft banner")).toBeInTheDocument();
    expect(
      screen.getByText(/Not Approved: this version cannot be published/),
    ).toBeInTheDocument();
  });
});
