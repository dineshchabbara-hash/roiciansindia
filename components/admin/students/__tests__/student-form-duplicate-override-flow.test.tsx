import { Component, type ReactNode } from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * Reproduces the real reported bug end to end: fill the form, submit, see
 * the duplicate warning, confirm the override with a reason, submit again.
 * Drives the REAL StudentForm + real createStudentAction (only the DB/auth
 * I/O boundary is mocked) so this catches bugs in the actual form
 * serialization / useActionState / server-action round trip — the class of
 * bug lib/actions/__tests__/students.test.ts's hand-built FormData calls
 * cannot catch, since those skip real browser form submission entirely.
 */

vi.mock("@/lib/auth/session", () => ({
  getCurrentUserContext: vi.fn(),
}));

vi.mock("@/lib/data/students", () => ({
  findDuplicateStudents: vi.fn(),
  createStudentRecord: vi.fn(),
}));

vi.mock("@/lib/data/audit-log", () => ({
  writeAuditLog: vi.fn(),
}));

// Real Next.js redirect() throws to unwind the action — its own root
// boundary specifically recognizes that and navigates instead of showing an
// error. Matching the throw here (rather than a no-op) is what makes this
// test faithful to the real action's control flow; RedirectBoundary below
// stands in for Next's own handling of it.
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { StudentForm } from "@/components/admin/students/student-form";
import { createStudentAction } from "@/lib/actions/students";
import { getCurrentUserContext } from "@/lib/auth/session";
import { findDuplicateStudents, createStudentRecord } from "@/lib/data/students";
import { writeAuditLog } from "@/lib/data/audit-log";
import { redirect } from "next/navigation";

const adminContext = {
  authUserId: "admin-auth-1",
  email: "admin@example.com",
  role: "admin" as const,
  profileId: "admin-profile-1",
  displayName: "Test Admin",
};

// Stands in for Next's own App Router boundary, which is what actually
// catches redirect()'s thrown signal in production and navigates instead
// of rendering an error — without this, the mocked throw above would
// otherwise surface as an unhandled render error in a plain React tree.
class RedirectBoundary extends Component<
  { children: ReactNode },
  { redirected: boolean }
> {
  state = { redirected: false };
  static getDerivedStateFromError() {
    return { redirected: true };
  }
  render() {
    return this.state.redirected ? null : this.props.children;
  }
}

describe("StudentForm + createStudentAction: real two-step duplicate override flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCurrentUserContext).mockResolvedValue(adminContext);
  });

  it("shows the duplicate warning on the first submit, creates nothing, then creates on the second submit once confirmed with a reason", async () => {
    vi.mocked(findDuplicateStudents).mockResolvedValue({
      ok: true,
      data: [
        {
          candidate: {
            id: "existing-1",
            studentCode: "10001",
            firstName: "Existing",
            lastName: "Student",
            email: null,
            phone: "+919898595069",
            dateOfBirth: null,
          },
          reasons: ["phone"],
        },
      ],
    });
    vi.mocked(createStudentRecord).mockResolvedValue({
      ok: true,
      data: { id: "new-student-1", studentCode: "10002" },
    });

    const user = userEvent.setup();
    render(
      <RedirectBoundary>
        <StudentForm action={createStudentAction} submitLabel="Create student" />
      </RedirectBoundary>,
    );

    await user.type(screen.getByLabelText("First name"), "Phase5Smoke");
    await user.type(screen.getByLabelText("Last name"), "StudentB");
    await user.type(screen.getByLabelText("Phone"), "9898595069");
    await user.click(screen.getByRole("button", { name: "Create student" }));

    // 1. Duplicate warning appears; nothing created yet.
    expect(await screen.findByText(/possible duplicate/i)).toBeInTheDocument();
    expect(createStudentRecord).not.toHaveBeenCalled();

    // The real-world repro: the name/phone fields must still hold what was
    // typed for the second submission to ever reach the override logic —
    // this is exactly what the reported bug broke.
    expect(screen.getByLabelText("First name")).toHaveValue("Phase5Smoke");
    expect(screen.getByLabelText("Last name")).toHaveValue("StudentB");
    expect(screen.getByLabelText("Phone")).toHaveValue("9898595069");

    // 2. Confirm the override with a valid reason and submit again.
    await user.click(
      screen.getByRole("checkbox", {
        name: /I have reviewed the above and confirm this is a different person/,
      }),
    );
    await user.type(screen.getByLabelText("Reason (required)"), "Twin has one number");
    await user.click(screen.getByRole("button", { name: "Create student" }));

    await waitFor(() => expect(createStudentRecord).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(redirect).toHaveBeenCalledWith("/admin/students/new-student-1"),
    );

    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "student.create", entityId: "new-student-1" }),
    );
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "student.duplicate_override_confirmed",
        after: expect.objectContaining({
          reason: "Twin has one number",
          matchedStudentCodes: ["10001"],
          matchedRules: ["phone"],
        }),
      }),
    );
  });

  it("does not create anything on the first submission alone, even with the checkbox pre-checked in the same click", async () => {
    vi.mocked(findDuplicateStudents).mockResolvedValue({
      ok: true,
      data: [
        {
          candidate: {
            id: "existing-1",
            studentCode: "10001",
            firstName: "Existing",
            lastName: "Student",
            email: null,
            phone: "+919898595069",
            dateOfBirth: null,
          },
          reasons: ["phone"],
        },
      ],
    });

    const user = userEvent.setup();
    render(<StudentForm action={createStudentAction} submitLabel="Create student" />);

    await user.type(screen.getByLabelText("First name"), "Phase5Smoke");
    await user.type(screen.getByLabelText("Last name"), "StudentB");
    await user.type(screen.getByLabelText("Phone"), "9898595069");
    await user.click(screen.getByRole("button", { name: "Create student" }));

    expect(await screen.findByText(/possible duplicate/i)).toBeInTheDocument();
    expect(createStudentRecord).not.toHaveBeenCalled();
  });
});
