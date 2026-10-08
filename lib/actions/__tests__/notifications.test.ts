import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Mocks only the I/O boundary (session, notifications data layer, audit
 * log, next/cache) so the real action control flow and the real
 * lib/validation/notifications.ts parsing run.
 */

vi.mock("@/lib/auth/session", () => ({
  getCurrentUserContext: vi.fn(),
}));

vi.mock("@/lib/data/notifications", () => ({
  resolveNotificationRecipient: vi.fn(),
  sendNotificationRecord: vi.fn(),
  markNotificationReadRecord: vi.fn(),
  markAllNotificationsReadRecord: vi.fn(),
}));

vi.mock("@/lib/data/audit-log", () => ({
  writeAuditLog: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import {
  markAllNotificationsReadAction,
  markNotificationReadAction,
  sendNotificationAction,
} from "@/lib/actions/notifications";
import { getCurrentUserContext } from "@/lib/auth/session";
import {
  markAllNotificationsReadRecord,
  markNotificationReadRecord,
  resolveNotificationRecipient,
  sendNotificationRecord,
} from "@/lib/data/notifications";
import { writeAuditLog } from "@/lib/data/audit-log";
import { revalidatePath } from "next/cache";

const STUDENT_PROFILE_ID = "11111111-2222-4333-8444-555555555555";
const NOTIFICATION_ID = "99999999-8888-4777-8666-555555555555";

const context = (role: "admin" | "super_admin" | "student" | "trainer") => ({
  authUserId: `${role}-auth-1`,
  email: `${role}@example.com`,
  role,
  profileId: `${role}-profile-1`,
  displayName: `Test ${role}`,
});

function sendForm(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  const values = {
    recipient: `student:${STUDENT_PROFILE_ID}`,
    title: "Fee reminder",
    body: "Please clear your balance.",
    ...overrides,
  };
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("sendNotificationAction", () => {
  it("rejects unauthenticated callers and non-admin roles without touching data", async () => {
    for (const ctx of [null, context("student"), context("trainer")]) {
      vi.mocked(getCurrentUserContext).mockResolvedValue(ctx);
      const result = await sendNotificationAction({}, sendForm());
      expect(result.formError).toMatch(/not authorized/i);
    }
    expect(resolveNotificationRecipient).not.toHaveBeenCalled();
    expect(sendNotificationRecord).not.toHaveBeenCalled();
  });

  it("returns field errors for invalid input and never resolves a recipient", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(context("admin"));
    const result = await sendNotificationAction(
      {},
      sendForm({ title: "  ", recipient: "admin:x" }),
    );
    expect(result.fieldErrors?.title).toBeDefined();
    expect(result.fieldErrors?.recipient).toBeDefined();
    expect(resolveNotificationRecipient).not.toHaveBeenCalled();
  });

  it("sends as the authenticated admin to the server-resolved recipient and audits minimally", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(context("admin"));
    vi.mocked(resolveNotificationRecipient).mockResolvedValue({
      ok: true,
      data: { authUserId: "resolved-student-auth", name: "Asha Rao", kind: "student" },
    });
    vi.mocked(sendNotificationRecord).mockResolvedValue({
      ok: true,
      data: { id: NOTIFICATION_ID },
    });

    const result = await sendNotificationAction({}, sendForm());

    expect(result).toEqual({ success: true });
    expect(resolveNotificationRecipient).toHaveBeenCalledWith({
      kind: "student",
      profileId: STUDENT_PROFILE_ID,
    });
    expect(sendNotificationRecord).toHaveBeenCalledWith({
      senderAuthUserId: "admin-auth-1",
      recipientAuthUserId: "resolved-student-auth",
      title: "Fee reminder",
      body: "Please clear your balance.",
    });
    expect(writeAuditLog).toHaveBeenCalledTimes(1);
    const audit = vi.mocked(writeAuditLog).mock.calls[0][0];
    expect(audit.action).toBe("notification.send");
    expect(audit.entityId).toBe(NOTIFICATION_ID);
    expect(audit.after).toEqual({
      recipientAuthUserId: "resolved-student-auth",
      recipientKind: "student",
    });
    expect(JSON.stringify(audit)).not.toContain("Fee reminder");
    expect(JSON.stringify(audit)).not.toContain("Please clear");
    expect(revalidatePath).toHaveBeenCalledWith("/admin/notifications");
  });

  it("super admin uses the same send path", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(context("super_admin"));
    vi.mocked(resolveNotificationRecipient).mockResolvedValue({
      ok: true,
      data: { authUserId: "resolved-trainer-auth", name: "T", kind: "trainer" },
    });
    vi.mocked(sendNotificationRecord).mockResolvedValue({
      ok: true,
      data: { id: NOTIFICATION_ID },
    });
    const result = await sendNotificationAction(
      {},
      sendForm({ recipient: `trainer:${STUDENT_PROFILE_ID}` }),
    );
    expect(result.success).toBe(true);
    expect(vi.mocked(sendNotificationRecord).mock.calls[0][0].senderAuthUserId).toBe(
      "super_admin-auth-1",
    );
  });

  it("surfaces an unresolvable recipient as a field error and sends nothing", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(context("admin"));
    vi.mocked(resolveNotificationRecipient).mockResolvedValue({
      ok: false,
      error: "That recipient does not have a portal login yet.",
    });
    const result = await sendNotificationAction({}, sendForm());
    expect(result.fieldErrors?.recipient).toMatch(/portal login/);
    expect(sendNotificationRecord).not.toHaveBeenCalled();
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it("returns a form error and does not audit when the insert fails", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(context("admin"));
    vi.mocked(resolveNotificationRecipient).mockResolvedValue({
      ok: true,
      data: { authUserId: "r", name: "R", kind: "student" },
    });
    vi.mocked(sendNotificationRecord).mockResolvedValue({
      ok: false,
      error: "Could not send.",
    });
    const result = await sendNotificationAction({}, sendForm());
    expect(result.formError).toBe("Could not send.");
    expect(writeAuditLog).not.toHaveBeenCalled();
  });
});

describe("mark read actions", () => {
  function idForm(id: string): FormData {
    const fd = new FormData();
    fd.set("notificationId", id);
    return fd;
  }

  it("marks the caller's own notification read and revalidates their portal", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(context("student"));
    vi.mocked(markNotificationReadRecord).mockResolvedValue({ ok: true, data: null });
    const result = await markNotificationReadAction({}, idForm(NOTIFICATION_ID));
    expect(result).toEqual({});
    expect(markNotificationReadRecord).toHaveBeenCalledWith({
      notificationId: NOTIFICATION_ID,
      recipientAuthUserId: "student-auth-1",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/student", "layout");
  });

  it("trainer mark-all-read uses the trainer's own auth id and portal", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(context("trainer"));
    vi.mocked(markAllNotificationsReadRecord).mockResolvedValue({
      ok: true,
      data: { updated: 2 },
    });
    const result = await markAllNotificationsReadAction();
    expect(result).toEqual({});
    expect(markAllNotificationsReadRecord).toHaveBeenCalledWith("trainer-auth-1");
    expect(revalidatePath).toHaveBeenCalledWith("/trainer", "layout");
  });

  it("rejects malformed ids and unauthenticated callers", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(context("student"));
    expect(
      (await markNotificationReadAction({}, idForm("nope"))).formError,
    ).toBeDefined();
    vi.mocked(getCurrentUserContext).mockResolvedValue(null);
    expect(
      (await markNotificationReadAction({}, idForm(NOTIFICATION_ID))).formError,
    ).toBeDefined();
    expect((await markAllNotificationsReadAction()).formError).toBeDefined();
    expect(markNotificationReadRecord).not.toHaveBeenCalled();
    expect(markAllNotificationsReadRecord).not.toHaveBeenCalled();
  });

  it("surfaces a not-found error from the data layer", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(context("student"));
    vi.mocked(markNotificationReadRecord).mockResolvedValue({
      ok: false,
      error: "Notification not found.",
    });
    const result = await markNotificationReadAction({}, idForm(NOTIFICATION_ID));
    expect(result.formError).toBe("Notification not found.");
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
