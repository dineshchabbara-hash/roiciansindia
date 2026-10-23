import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("@/lib/actions/website-programs", () => ({
  createProgramWebsiteAction: vi.fn(),
  saveProgramDraftAction: vi.fn(),
  publishProgramAction: vi.fn(),
  unpublishProgramAction: vi.fn(),
  restoreProgramRevisionAction: vi.fn(),
  changeProgramSlugAction: vi.fn(),
  updateProgramPlacementAction: vi.fn(),
  moveFeaturedProgramAction: vi.fn(),
  removeFeaturedProgramAction: vi.fn(),
  createDisplayGroupAction: vi.fn(),
  updateDisplayGroupAction: vi.fn(),
  moveDisplayGroupAction: vi.fn(),
  archiveDisplayGroupAction: vi.fn(),
  restoreDisplayGroupAction: vi.fn(),
  saveBatchPublicationAction: vi.fn(),
  publishBatchAction: vi.fn(),
  unpublishBatchAction: vi.fn(),
}));
vi.mock("@/lib/actions/website", () => ({
  createWebsitePageAction: vi.fn(),
  restoreWebsiteRevisionAction: vi.fn(),
  saveWebsiteDraftAction: vi.fn(),
  publishWebsitePageAction: vi.fn(),
  unpublishWebsitePageAction: vi.fn(),
}));

import { ProgramWebsiteList } from "@/components/admin/website/programs/program-website-list";
import {
  ProgramPlacementForm,
  ProgramSlugForm,
} from "@/components/admin/website/programs/program-settings-forms";
import { DisplayGroupsManager } from "@/components/admin/website/programs/display-groups-manager";
import {
  FeaturedProgramsManager,
  type FeaturedProgram,
} from "@/components/admin/website/programs/featured-programs-manager";
import { BatchPublications } from "@/components/admin/website/programs/batch-publications";
import {
  ProgramWebsiteNav,
  WebsiteAreaNav,
} from "@/components/admin/website/programs/website-area-nav";
import * as actions from "@/lib/actions/website-programs";
import type {
  ArchivedDisplayGroup,
  DisplayGroup,
  ProgramBatch,
  ProgramWebsiteSummary,
} from "@/lib/data/website-programs";
import { PUBLISHED_SLUG_LOCKED_MESSAGE } from "@/lib/domain/website-programs";

const P1 = "11111111-0000-4000-8000-000000000001";
const P2 = "11111111-0000-4000-8000-000000000002";
const P3 = "11111111-0000-4000-8000-000000000003";
const DOC = "aaaaaaaa-0000-4000-8000-000000000001";
const DOC2 = "aaaaaaaa-0000-4000-8000-000000000002";
const G1 = "dddddddd-0000-4000-8000-000000000001";
const G2 = "dddddddd-0000-4000-8000-000000000002";
const B1 = "eeeeeeee-0000-4000-8000-000000000001";

function submitted(fn: unknown, call = 0): FormData {
  return vi.mocked(fn as (...a: unknown[]) => unknown).mock.calls[call][1] as FormData;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("WebsiteAreaNav and ProgramWebsiteNav", () => {
  it("marks the current area and links every area", () => {
    render(<WebsiteAreaNav current="groups" />);
    const nav = screen.getByRole("navigation", { name: "Website management" });
    expect(within(nav).getByRole("link", { name: "Display groups" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(nav).getByRole("link", { name: "Featured Programs" })).toHaveAttribute(
      "href",
      "/admin/website/featured",
    );
  });

  it("links one Program's screens", () => {
    render(<ProgramWebsiteNav documentId={DOC} current="batches" />);
    expect(screen.getByRole("link", { name: "Batches on the website" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Version history" })).toHaveAttribute(
      "href",
      `/admin/website/programs/${DOC}/history`,
    );
  });
});

describe("ProgramWebsiteList", () => {
  const entries: ProgramWebsiteSummary[] = [
    {
      program: { id: P1, code: "ST-01", name: "Software Testing", status: "active" },
      document: {
        id: DOC,
        slug: "software-testing",
        status: "published",
        title: "Software Testing Pro",
        latestRevisionId: "r1",
        latestRevisionNumber: 1,
        publishedRevisionId: "r1",
        version: 3,
        firstPublishedAt: "2026-10-23T10:00:00Z",
        publishedAt: "2026-10-23T10:00:00Z",
        unpublishedAt: null,
        updatedAt: "2026-10-23T10:00:00Z",
        placement: {
          displayGroupId: G1,
          displayGroupName: "Quality Engineering",
          isFeatured: true,
          featuredOrder: 2,
          displayOrder: 1,
        },
      },
    },
    {
      program: { id: P2, code: "DA-01", name: "Data Analytics & BI", status: "draft" },
      document: null,
    },
    {
      program: { id: P3, code: "OLD", name: "Old Program", status: "archived" },
      document: null,
    },
  ];

  it("shows each Program's website status, address, group and featured position", () => {
    render(<ProgramWebsiteList entries={entries} />);
    const row = screen.getByRole("row", { name: /Software Testing ST-01/ });
    expect(within(row).getByText("Published")).toBeInTheDocument();
    expect(within(row).getByText("/programs/software-testing")).toBeInTheDocument();
    expect(within(row).getByText("Quality Engineering")).toBeInTheDocument();
    expect(within(row).getByText("Featured #2")).toBeInTheDocument();
    expect(
      within(row).getByRole("link", {
        name: "Edit website content for Software Testing",
      }),
    ).toHaveAttribute("href", `/admin/website/programs/${DOC}`);
  });

  it("offers set-up with a suggested address (editable, nothing else copied)", () => {
    render(<ProgramWebsiteList entries={entries} />);
    const form = screen.getByRole("form", {
      name: "Set up website content for Data Analytics & BI",
    });
    expect(within(form).getByLabelText("Web address")).toHaveValue(
      "data-analytics-and-bi",
    );
    expect(
      screen.getByText("Archived Programs cannot get website content."),
    ).toBeInTheDocument();
  });

  it("never shows fees", () => {
    const { container } = render(<ProgramWebsiteList entries={entries} />);
    expect(container.textContent).not.toMatch(/₹|fee/i);
  });
});

describe("ProgramSlugForm", () => {
  it("locks the address of a published Program with the reason, and has no input", () => {
    render(
      <ProgramSlugForm documentId={DOC} slug="software-testing" version={3} locked />,
    );
    expect(screen.getByText(PUBLISHED_SLUG_LOCKED_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Change web address" })).toBeNull();
  });

  it("changes a never-published address with the document version", async () => {
    vi.mocked(actions.changeProgramSlugAction).mockResolvedValue({
      message: "Web address changed.",
      version: 4,
    });
    render(
      <ProgramSlugForm
        documentId={DOC}
        slug="software-testing"
        version={3}
        locked={false}
      />,
    );
    fireEvent.change(screen.getByLabelText("New web address"), {
      target: { value: "software-testing-pro" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Change web address" }));
    });
    const fd = submitted(actions.changeProgramSlugAction);
    expect(fd.get("slug")).toBe("software-testing-pro");
    expect(fd.get("expectedVersion")).toBe("3");
    expect(await screen.findByText("Web address changed.")).toBeInTheDocument();
  });
});

describe("ProgramPlacementForm", () => {
  const groups = [
    { id: G1, name: "Quality Engineering", isVisible: true },
    { id: G2, name: "Data and AI", isVisible: false },
  ];

  it("asks for confirmation, naming a featured change, before saving", async () => {
    vi.mocked(actions.updateProgramPlacementAction).mockResolvedValue({
      message: "Placement saved. It applies to the public website straight away.",
      version: 5,
    });
    render(
      <ProgramPlacementForm
        documentId={DOC}
        programName="Software Testing"
        version={4}
        groups={groups}
        placement={{
          displayGroupId: null,
          isFeatured: false,
          featuredOrder: null,
          displayOrder: null,
        }}
      />,
    );
    expect(
      screen.getByRole("option", { name: "Data and AI (hidden)" }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Display group"), { target: { value: G1 } });
    fireEvent.click(screen.getByLabelText("Featured Program"));
    expect(actions.updateProgramPlacementAction).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Save placement…" }));
    expect(
      screen.getByText(
        /applies to the public website straight away\. Software Testing will be added to the featured Programs\./,
      ),
    ).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Confirm placement" }));
    });
    const fd = submitted(actions.updateProgramPlacementAction);
    expect(fd.get("displayGroupId")).toBe(G1);
    expect(fd.get("isFeatured")).toBe("on");
    expect(fd.get("featuredOrder")).toBe("");
    expect(fd.get("expectedVersion")).toBe("4");
    expect(await screen.findByRole("status")).toHaveTextContent("Placement saved");
  });

  it("can be cancelled without saving", () => {
    render(
      <ProgramPlacementForm
        documentId={DOC}
        programName="Software Testing"
        version={4}
        groups={groups}
        placement={{
          displayGroupId: G1,
          isFeatured: true,
          featuredOrder: 1,
          displayOrder: 2,
        }}
      />,
    );
    fireEvent.click(screen.getByLabelText("Featured Program"));
    fireEvent.click(screen.getByRole("button", { name: "Save placement…" }));
    expect(
      screen.getByText(/will be removed from the featured Programs/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("button", { name: "Confirm placement" })).toBeNull();
    expect(actions.updateProgramPlacementAction).not.toHaveBeenCalled();
  });
});

describe("DisplayGroupsManager", () => {
  const groups: DisplayGroup[] = [
    {
      id: G1,
      name: "Quality Engineering",
      description: null,
      displayOrder: 1,
      isVisible: true,
      version: 2,
      programCount: 3,
    },
    {
      id: G2,
      name: "Data and AI",
      description: "Analytics and AI",
      displayOrder: 2,
      isVisible: false,
      version: 5,
      programCount: 0,
    },
  ];

  it("lists groups in order with visibility and Program counts", () => {
    render(<DisplayGroupsManager groups={groups} />);
    const list = screen.getByRole("list");
    const items = within(list).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Quality Engineering");
    expect(items[0]).toHaveTextContent("Visible");
    expect(items[0]).toHaveTextContent("3 Programs");
    expect(items[1]).toHaveTextContent("Hidden");
    expect(
      screen.getByRole("button", { name: "Move Quality Engineering up" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move Data and AI down" })).toBeDisabled();
  });

  it("moves a group by submitting the whole order that was shown", async () => {
    vi.mocked(actions.moveDisplayGroupAction).mockResolvedValue({
      message: "Group order saved.",
    });
    render(<DisplayGroupsManager groups={groups} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Move Data and AI up" }));
    });
    const fd = submitted(actions.moveDisplayGroupAction);
    expect(fd.get("groupId")).toBe(G2);
    expect(fd.get("direction")).toBe("up");
    expect(JSON.parse(String(fd.get("orderedIds")))).toEqual([G1, G2]);
  });

  it("renames and hides a group with its version", async () => {
    vi.mocked(actions.updateDisplayGroupAction).mockResolvedValue({
      message: "Display group saved.",
      version: 3,
    });
    render(<DisplayGroupsManager groups={groups} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Quality Engineering" }));
    const item = screen.getAllByRole("listitem")[0];
    fireEvent.change(within(item).getByLabelText("Group name"), {
      target: { value: "Quality and Testing" },
    });
    fireEvent.click(within(item).getByLabelText(/Visible on the website/));
    await act(async () => {
      fireEvent.click(within(item).getByRole("button", { name: "Save group" }));
    });
    const fd = submitted(actions.updateDisplayGroupAction);
    expect(fd.get("name")).toBe("Quality and Testing");
    expect(fd.get("isVisible")).toBeNull();
    expect(fd.get("expectedVersion")).toBe("2");
  });

  it("creates a group and shows a duplicate name next to the field", async () => {
    vi.mocked(actions.createDisplayGroupAction).mockResolvedValue({
      error: "A display group with that name already exists.",
      fieldErrors: { name: ["A display group with that name already exists."] },
    });
    render(<DisplayGroupsManager groups={groups} />);
    const form = screen.getByRole("form", { name: "Create a display group" });
    fireEvent.change(within(form).getByLabelText("Group name"), {
      target: { value: "Data and AI" },
    });
    await act(async () => {
      fireEvent.click(within(form).getByRole("button", { name: "Create group" }));
    });
    expect(
      await within(form).findByText("A display group with that name already exists."),
    ).toBeInTheDocument();
  });
});

describe("DisplayGroupsManager archive and restore", () => {
  const G3 = "dddddddd-0000-4000-8000-000000000003";
  const active: DisplayGroup[] = [
    {
      id: G1,
      name: "Quality Engineering",
      description: null,
      displayOrder: 1,
      isVisible: true,
      version: 2,
      programCount: 3,
    },
    {
      id: G2,
      name: "Data and AI",
      description: null,
      displayOrder: 2,
      isVisible: false,
      version: 5,
      programCount: 0,
    },
  ];
  const archived: ArchivedDisplayGroup[] = [
    {
      id: G3,
      name: "Cloud",
      description: "Retired group",
      isVisible: true,
      version: 8,
      archivedAt: "2026-10-20T09:00:00Z",
    },
  ];

  it("shows archived groups separately, with a Restore button", () => {
    render(<DisplayGroupsManager groups={active} archivedGroups={archived} />);
    const activeList = screen.getByRole("list", { name: "" });
    expect(within(activeList).queryByText("Cloud")).toBeNull();
    const archivedList = screen.getByRole("list", { name: "Archived groups" });
    expect(archivedList).toHaveTextContent("Cloud");
    expect(archivedList).toHaveTextContent("Archived");
    expect(archivedList).toHaveTextContent(/Archived 20 Oct 2026/);
    expect(screen.getByRole("button", { name: "Restore Cloud" })).toBeEnabled();
  });

  it("says when there are no archived groups", () => {
    render(<DisplayGroupsManager groups={active} />);
    expect(screen.getByText("No archived groups.")).toBeInTheDocument();
  });

  it("cannot archive a group that holds Programs, and explains the alternatives", () => {
    render(<DisplayGroupsManager groups={active} />);
    const button = screen.getByRole("button", { name: "Archive Quality Engineering" });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription(
      "To archive this group, first move its Programs to another group, or hide the group instead.",
    );
    expect(screen.getByRole("button", { name: "Archive Data and AI" })).toBeEnabled();
  });

  it("asks for confirmation before archiving, and Cancel archives nothing", async () => {
    vi.mocked(actions.archiveDisplayGroupAction).mockResolvedValue({
      message: 'Display group "Data and AI" archived.',
    });
    render(<DisplayGroupsManager groups={active} />);
    fireEvent.click(screen.getByRole("button", { name: "Archive Data and AI" }));
    expect(
      screen.getByText(/Archive "Data and AI"\? It holds no Programs/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("button", { name: "Confirm archive" })).toBeNull();
    expect(actions.archiveDisplayGroupAction).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Archive Data and AI" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Confirm archive" }));
    });
    const fd = submitted(actions.archiveDisplayGroupAction);
    expect(fd.get("groupId")).toBe(G2);
    expect(fd.get("expectedVersion")).toBe("5");
    expect(await screen.findByRole("status", { name: "" })).toHaveTextContent(
      'Display group "Data and AI" archived.',
    );
    expect(screen.queryByRole("button", { name: "Confirm archive" })).toBeNull();
  });

  it("shows a refused archive as an alert", async () => {
    vi.mocked(actions.archiveDisplayGroupAction).mockResolvedValue({
      error: "This group still holds Programs, so it cannot be archived.",
    });
    render(<DisplayGroupsManager groups={active} />);
    fireEvent.click(screen.getByRole("button", { name: "Archive Data and AI" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Confirm archive" }));
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This group still holds Programs, so it cannot be archived.",
    );
  });

  it("restores a group with its version and shows the outcome", async () => {
    vi.mocked(actions.restoreDisplayGroupAction).mockResolvedValue({
      message: "Display group restored.",
    });
    render(<DisplayGroupsManager groups={active} archivedGroups={archived} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Restore Cloud" }));
    });
    const fd = submitted(actions.restoreDisplayGroupAction);
    expect(fd.get("groupId")).toBe(G3);
    expect(fd.get("expectedVersion")).toBe("8");
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Display group restored.",
    );
  });

  it("does not offer Restore when an active group already uses the name", () => {
    render(
      <DisplayGroupsManager
        groups={active}
        archivedGroups={[{ ...archived[0], name: "  data AND ai " }]}
      />,
    );
    const button = screen.getByRole("button", { name: /Restore/ });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription(
      "An active group already uses this name. Rename or archive that group before restoring this one.",
    );
  });

  it("shows a refused restore (name taken meanwhile) as an alert", async () => {
    vi.mocked(actions.restoreDisplayGroupAction).mockResolvedValue({
      error:
        "An active display group already uses this name, so this group cannot be restored.",
    });
    render(<DisplayGroupsManager groups={active} archivedGroups={archived} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Restore Cloud" }));
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /already uses this name, so this group cannot be restored/,
    );
  });
});

describe("FeaturedProgramsManager", () => {
  const programs: FeaturedProgram[] = [
    {
      documentId: DOC,
      version: 7,
      programName: "Software Testing",
      headline: "Software Testing Pro",
      status: "published",
      featuredOrder: 1,
    },
    {
      documentId: DOC2,
      version: 8,
      programName: "Data Analytics",
      headline: null,
      status: "draft",
      featuredOrder: 2,
    },
  ];

  it("confirms a move, naming the new position, and sends the list as shown", async () => {
    vi.mocked(actions.moveFeaturedProgramAction).mockResolvedValue({
      message: "Featured order saved.",
    });
    render(<FeaturedProgramsManager programs={programs} />);
    expect(
      screen.getByRole("button", { name: "Move Software Testing up" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Move Data Analytics up" }));
    expect(actions.moveFeaturedProgramAction).not.toHaveBeenCalled();
    expect(screen.getByText(/Move Data Analytics to position 1\?/)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Confirm move" }));
    });
    const fd = submitted(actions.moveFeaturedProgramAction);
    expect(fd.get("documentId")).toBe(DOC2);
    expect(fd.get("direction")).toBe("up");
    expect(JSON.parse(String(fd.get("seen")))).toEqual([
      { id: DOC, version: 7 },
      { id: DOC2, version: 8 },
    ]);
    expect(await screen.findByRole("status")).toHaveTextContent("Featured order saved.");
  });

  it("confirms removal with its version", async () => {
    vi.mocked(actions.removeFeaturedProgramAction).mockResolvedValue({
      message: "Removed from featured Programs.",
    });
    render(<FeaturedProgramsManager programs={programs} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Remove Software Testing from featured" }),
    );
    expect(
      screen.getByText(/Its content, group and publication are not changed/),
    ).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Confirm removal" }));
    });
    const fd = submitted(actions.removeFeaturedProgramAction);
    expect(fd.get("documentId")).toBe(DOC);
    expect(fd.get("expectedVersion")).toBe("7");
  });

  it("explains how to feature a Program when none is featured", () => {
    render(<FeaturedProgramsManager programs={[]} />);
    expect(screen.getByText(/No Programs are featured/)).toBeInTheDocument();
  });
});

describe("BatchPublications", () => {
  const batch = (overrides: Partial<ProgramBatch> = {}): ProgramBatch => ({
    id: B1,
    name: "ST-MAR27-WKND",
    startDate: "2027-03-06",
    status: "upcoming",
    publication: null,
    ...overrides,
  });

  it("labels the internal name and shows no internal Batch facts", () => {
    const { container } = render(
      <BatchPublications documentId={DOC} batches={[batch()]} />,
    );
    expect(screen.getByText("(internal name, never shown publicly)")).toBeInTheDocument();
    expect(screen.getByText("Not on the website")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(
      /capacity|seats left|meet\.|zoom|trainer:/i,
    );
  });

  it("saves a new public label and state with version 0, then needs a save before publishing", async () => {
    vi.mocked(actions.saveBatchPublicationAction).mockResolvedValue({
      message: "Saved.",
      version: 1,
    });
    render(<BatchPublications documentId={DOC} batches={[batch()]} />);
    expect(screen.getByRole("button", { name: "Publish…" })).toBeDisabled();
    expect(
      screen.getByText("Save a public label and registration state first."),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Public label"), {
      target: { value: "Weekend batch, starts 6 March" },
    });
    fireEvent.click(screen.getByLabelText("Open"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save website settings" }));
    });
    const fd = submitted(actions.saveBatchPublicationAction);
    expect(fd.get("batchId")).toBe(B1);
    expect(fd.get("expectedVersion")).toBe("0");
    expect(fd.get("publicLabel")).toBe("Weekend batch, starts 6 March");
    expect(fd.get("registrationState")).toBe("open");
  });

  it("confirms publishing the saved label and state", async () => {
    vi.mocked(actions.publishBatchAction).mockResolvedValue({
      message: "Batch published.",
      version: 3,
    });
    render(
      <BatchPublications
        documentId={DOC}
        batches={[
          batch({
            publication: {
              draftLabel: "Weekend batch",
              draftState: "full",
              isPublished: true,
              publishedLabel: "Weekend batch",
              publishedState: "open",
              firstPublishedAt: "2026-10-23T10:00:00Z",
              version: 2,
            },
          }),
        ]}
      />,
    );
    expect(screen.getByText("Published, with unpublished changes")).toBeInTheDocument();
    expect(screen.getByText(/On the website:/)).toHaveTextContent("Weekend batch · Open");
    fireEvent.click(screen.getByRole("button", { name: "Publish…" }));
    expect(screen.getByText(/with registration Full\?/)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Confirm publish" }));
    });
    expect(submitted(actions.publishBatchAction).get("expectedVersion")).toBe("2");
  });

  it("does not offer publishing for a completed Batch, and confirms unpublishing", async () => {
    vi.mocked(actions.unpublishBatchAction).mockResolvedValue({
      message: "Batch removed from the website.",
      version: 3,
    });
    render(
      <BatchPublications
        documentId={DOC}
        batches={[
          batch({
            status: "completed",
            publication: {
              draftLabel: "Weekend batch",
              draftState: "open",
              isPublished: true,
              publishedLabel: "Weekend batch",
              publishedState: "open",
              firstPublishedAt: "2026-10-23T10:00:00Z",
              version: 2,
            },
          }),
        ]}
      />,
    );
    expect(screen.getByRole("button", { name: "Publish…" })).toBeDisabled();
    expect(
      screen.getByText(
        "Only an upcoming or active Batch can be published on the website.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Unpublish…" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Confirm unpublish" }));
    });
    await waitFor(() => expect(actions.unpublishBatchAction).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Batch removed from the website.",
    );
  });
});
