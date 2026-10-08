import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

/**
 * Pins the rendered DOM contract the Phase 18 E2E suite relies on: each
 * inbox item is a listitem labelled by its title with a durable
 * "Unread"/"Read" status, the exact unread summary text, the
 * Mark-as-read / Mark-all-as-read controls only when there is something
 * unread, the send form's labelled fields, and the nav unread badge's
 * accessible name. Server actions are stubbed; this is render-only.
 */

vi.mock("@/lib/actions/notifications", () => ({
  markNotificationReadAction: vi.fn(),
  markAllNotificationsReadAction: vi.fn(),
  sendNotificationAction: vi.fn(),
}));

const mockUsePathname = vi.fn(() => "/student/notifications");
vi.mock("next/navigation", () => ({
  usePathname: () => mockUsePathname(),
}));

const { NotificationInbox } =
  await import("@/components/notifications/notification-inbox");
const { SendNotificationForm } =
  await import("@/components/admin/notifications/send-notification-form");
const { StudentNav } = await import("@/components/student/student-nav");
const { TrainerNav } = await import("@/components/trainer/trainer-nav");

const UNREAD = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Fee reminder",
  body: "Line one\n<b>not html</b>",
  isRead: false,
  readAt: null,
  createdAt: "2026-10-08T10:00:00Z",
};
const READ = {
  id: "22222222-2222-4222-8222-222222222222",
  title: "Welcome",
  body: "Hello",
  isRead: true,
  readAt: "2026-10-08T11:00:00Z",
  createdAt: "2026-10-07T10:00:00Z",
};

describe("NotificationInbox", () => {
  it("renders each notification as a titled list item with a durable status", () => {
    render(<NotificationInbox notifications={[UNREAD, READ]} unreadCount={1} />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Notifications" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("1 unread notification", { exact: true }),
    ).toBeInTheDocument();

    const list = screen.getByRole("list", { name: "Your notifications" });
    const unreadItem = within(list).getByRole("listitem", { name: "Fee reminder" });
    const readItem = within(list).getByRole("listitem", { name: "Welcome" });

    expect(within(unreadItem).getByText("Unread", { exact: true })).toBeInTheDocument();
    expect(
      within(unreadItem).getByRole("button", { name: "Mark as read" }),
    ).toBeInTheDocument();
    expect(within(readItem).getByText("Read", { exact: true })).toBeInTheDocument();
    expect(within(readItem).queryByRole("button", { name: "Mark as read" })).toBeNull();

    expect(screen.getByRole("button", { name: "Mark all as read" })).toBeInTheDocument();
  });

  it("renders the body as plain text, never HTML", () => {
    const { container } = render(
      <NotificationInbox notifications={[UNREAD]} unreadCount={1} />,
    );
    expect(container.querySelector("b")).toBeNull();
    expect(screen.getByText(/<b>not html<\/b>/)).toBeInTheDocument();
  });

  it("hides mark-all and shows the zero summary when nothing is unread", () => {
    render(<NotificationInbox notifications={[READ]} unreadCount={0} />);
    expect(
      screen.getByText("No unread notifications", { exact: true }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark all as read" })).toBeNull();
  });

  it("shows an empty state", () => {
    render(<NotificationInbox notifications={[]} unreadCount={0} />);
    expect(screen.getByText("You have no notifications yet.")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Your notifications" })).toBeNull();
  });
});

describe("SendNotificationForm", () => {
  it("exposes labelled recipient/title/message fields and posts profile references", () => {
    render(
      <SendNotificationForm
        options={[
          {
            kind: "student",
            profileId: "33333333-3333-4333-8333-333333333333",
            name: "Asha Rao",
            email: "asha@x.test",
          },
        ]}
      />,
    );
    const form = screen.getByRole("form", { name: "Send a notification" });
    const recipient = within(form).getByLabelText("Recipient") as HTMLSelectElement;
    expect(within(form).getByLabelText("Title")).toBeInTheDocument();
    expect(within(form).getByLabelText("Message")).toBeInTheDocument();
    const option = within(recipient).getByRole("option", {
      name: "Asha Rao (Student, asha@x.test)",
    });
    expect((option as HTMLOptionElement).value).toBe(
      "student:33333333-3333-4333-8333-333333333333",
    );
    expect(within(form).getByRole("button", { name: "Send notification" })).toBeEnabled();
  });

  it("disables sending until a recipient search has results", () => {
    render(<SendNotificationForm options={[]} />);
    expect(screen.getByRole("button", { name: "Send notification" })).toBeDisabled();
  });
});

describe("portal nav unread badge", () => {
  it("adds the unread count to the Student Notifications link name", () => {
    render(<StudentNav unreadNotificationCount={2} />);
    expect(screen.getByRole("link", { name: "Notifications, 2 unread" })).toHaveAttribute(
      "href",
      "/student/notifications",
    );
  });

  it("shows no badge when nothing is unread", () => {
    render(<StudentNav unreadNotificationCount={0} />);
    expect(screen.getByRole("link", { name: "Notifications" })).toBeInTheDocument();
  });

  it("adds the badge to the Trainer Notifications link", () => {
    mockUsePathname.mockReturnValue("/trainer");
    render(<TrainerNav unreadNotificationCount={1} />);
    expect(screen.getByRole("link", { name: "Notifications, 1 unread" })).toHaveAttribute(
      "href",
      "/trainer/notifications",
    );
  });
});
