import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({ getCurrentUserContext: vi.fn() }));
vi.mock("@/lib/data/accounts", () => ({
  provisionStudentPortalAccess: vi.fn(),
  createAdminAccount: vi.fn(),
  setAdminAccountStatus: vi.fn(),
}));
vi.mock("@/lib/data/audit-log", () => ({ writeAuditLog: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
  createAdminAccountAction,
  provisionStudentPortalAccessAction,
  setAdminAccountStatusAction,
} from "@/lib/actions/accounts";
import { getCurrentUserContext } from "@/lib/auth/session";
import {
  createAdminAccount,
  provisionStudentPortalAccess,
  setAdminAccountStatus,
} from "@/lib/data/accounts";
import { writeAuditLog } from "@/lib/data/audit-log";

const STUDENT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-000000000001";
const ADMIN_ID = "aaaaaaaa-bbbb-4ccc-8ddd-000000000002";

function context(
  role: "admin" | "super_admin" | "trainer" | "student",
  profileId?: string,
) {
  return {
    authUserId: `${role}-auth-1`,
    email: `${role}@example.com`,
    role,
    profileId: profileId ?? `${role}-profile-1`,
    displayName: `Test ${role}`,
  };
}

function form(values: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("provisionStudentPortalAccessAction", () => {
  it.each(["trainer", "student"] as const)("refuses a %s", async (role) => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(context(role));
    const state = await provisionStudentPortalAccessAction(
      {},
      form({ studentId: STUDENT_ID }),
    );
    expect(state.formError).toBe("You are not authorized to give portal access.");
    expect(provisionStudentPortalAccess).not.toHaveBeenCalled();
  });

  it("refuses an anonymous caller", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(null);
    await provisionStudentPortalAccessAction({}, form({ studentId: STUDENT_ID }));
    expect(provisionStudentPortalAccess).not.toHaveBeenCalled();
  });

  it("lets an Admin provision and audits only a new link", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(context("admin"));
    vi.mocked(provisionStudentPortalAccess).mockResolvedValue({
      ok: true,
      data: { outcome: "linked", studentCode: "10042", email: "asha@example.com" },
    });
    const state = await provisionStudentPortalAccessAction(
      {},
      form({ studentId: STUDENT_ID }),
    );
    expect(state.message).toBe("Portal access created for asha@example.com.");
    expect(writeAuditLog).toHaveBeenCalledWith({
      actorAuthUserId: "admin-auth-1",
      actorRole: "admin",
      action: "student.portal_access_granted",
      entityType: "student",
      entityId: STUDENT_ID,
      after: { studentCode: "10042", loginEmail: "asha@example.com" },
    });

    vi.mocked(writeAuditLog).mockClear();
    vi.mocked(provisionStudentPortalAccess).mockResolvedValue({
      ok: true,
      data: {
        outcome: "already_linked",
        studentCode: "10042",
        email: "asha@example.com",
      },
    });
    const again = await provisionStudentPortalAccessAction(
      {},
      form({ studentId: STUDENT_ID }),
    );
    expect(again.message).toBe("This student already has portal access.");
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it("rejects a malformed student id before any provisioning", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(context("super_admin"));
    const state = await provisionStudentPortalAccessAction({}, form({ studentId: "x" }));
    expect(state.formError).toBeTruthy();
    expect(provisionStudentPortalAccess).not.toHaveBeenCalled();
  });
});

describe("createAdminAccountAction", () => {
  const values = {
    firstName: "Asha",
    lastName: "Rao",
    email: "asha@example.com",
    role: "super_admin",
  };

  it("is Super Admin only — an Admin cannot create or promote admins", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(context("admin"));
    const state = await createAdminAccountAction({}, form(values));
    expect(state.formError).toBe("Only a Super Admin can create admin accounts.");
    expect(createAdminAccount).not.toHaveBeenCalled();
  });

  it("creates with names and email only (a submitted role is ignored) and audits", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(context("super_admin"));
    vi.mocked(createAdminAccount).mockResolvedValue({
      ok: true,
      data: { outcome: "created", adminId: ADMIN_ID, email: "asha@example.com" },
    });
    const state = await createAdminAccountAction({}, form(values));
    expect(createAdminAccount).toHaveBeenCalledWith({
      firstName: "Asha",
      lastName: "Rao",
      email: "asha@example.com",
    });
    expect(state.message).toBe("Admin account created for asha@example.com.");
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "admin_account.created",
        entityType: "admin_account",
        entityId: ADMIN_ID,
        after: { email: "asha@example.com", roleLevel: "admin" },
      }),
    );
  });

  it("returns field errors for an invalid form", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(context("super_admin"));
    const state = await createAdminAccountAction(
      {},
      form({ firstName: "", lastName: "R", email: "x" }),
    );
    expect(state.fieldErrors?.firstName).toBeTruthy();
    expect(state.fieldErrors?.email).toBeTruthy();
    expect(createAdminAccount).not.toHaveBeenCalled();
  });
});

describe("setAdminAccountStatusAction", () => {
  it("is Super Admin only", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(context("admin"));
    const state = await setAdminAccountStatusAction(
      {},
      form({ adminId: ADMIN_ID, status: "inactive" }),
    );
    expect(state.formError).toBe("Only a Super Admin can change admin accounts.");
    expect(setAdminAccountStatus).not.toHaveBeenCalled();
  });

  it("refuses to change the caller's own account", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(context("super_admin", ADMIN_ID));
    const state = await setAdminAccountStatusAction(
      {},
      form({ adminId: ADMIN_ID, status: "inactive" }),
    );
    expect(state.formError).toBe("You cannot change your own account.");
    expect(setAdminAccountStatus).not.toHaveBeenCalled();
  });

  it("deactivates another admin and audits the change", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(context("super_admin"));
    vi.mocked(setAdminAccountStatus).mockResolvedValue({
      ok: true,
      data: { outcome: "updated", email: "a@b.co" },
    });
    const state = await setAdminAccountStatusAction(
      {},
      form({ adminId: ADMIN_ID, status: "inactive" }),
    );
    expect(state.message).toBe("Admin account deactivated.");
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "admin_account.deactivated",
        entityType: "admin_account",
        entityId: ADMIN_ID,
      }),
    );
  });
});
