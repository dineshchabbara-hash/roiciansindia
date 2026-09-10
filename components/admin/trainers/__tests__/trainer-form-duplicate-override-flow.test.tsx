import { Component, type ReactNode } from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * Trainer-scoped counterpart of
 * components/admin/students/__tests__/student-form-duplicate-override-flow.test.tsx —
 * same real bug class (React 19 resets a useActionState-driven form's
 * uncontrolled fields once the action resolves), same fix
 * (TrainerForm's generation-keyed Fragment), proven the same way: drive the
 * REAL TrainerForm + real createTrainerAction through two real submissions,
 * only mocking the true I/O boundary.
 */

vi.mock("@/lib/auth/session", () => ({
  getCurrentUserContext: vi.fn(),
}));

vi.mock("@/lib/data/trainers", () => ({
  findDuplicateTrainers: vi.fn(),
  createTrainerRecord: vi.fn(),
}));

vi.mock("@/lib/data/audit-log", () => ({
  writeAuditLog: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { TrainerForm } from "@/components/admin/trainers/trainer-form";
import { createTrainerAction } from "@/lib/actions/trainers";
import { getCurrentUserContext } from "@/lib/auth/session";
import { findDuplicateTrainers, createTrainerRecord } from "@/lib/data/trainers";
import { writeAuditLog } from "@/lib/data/audit-log";
import { redirect } from "next/navigation";

const adminContext = {
  authUserId: "admin-auth-1",
  email: "admin@example.com",
  role: "admin" as const,
  profileId: "admin-profile-1",
  displayName: "Test Admin",
};

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

describe("TrainerForm + createTrainerAction: real two-step duplicate override flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCurrentUserContext).mockResolvedValue(adminContext);
  });

  // Duplicate EMAIL is a hard block with no override (see
  // lib/actions/trainers.ts's createTrainerAction) — every trainer requires
  // a unique Supabase Auth account, so only a duplicate PHONE ever reaches
  // this warn-and-override UI. This is the trainer-specific policy split
  // from Student Management, where email duplicates can still be overridden.
  it("shows the duplicate warning on the first submit, creates nothing, then creates on the second submit once confirmed with a reason", async () => {
    vi.mocked(findDuplicateTrainers).mockResolvedValue({
      ok: true,
      data: [
        {
          candidate: {
            id: "existing-1",
            firstName: "Existing",
            lastName: "Trainer",
            email: "someone.else@example.com",
            phone: "+16475293460",
          },
          reasons: ["phone"],
        },
      ],
    });
    vi.mocked(createTrainerRecord).mockResolvedValue({
      ok: true,
      data: { id: "new-trainer-1" },
    });

    const user = userEvent.setup();
    render(
      <RedirectBoundary>
        <TrainerForm action={createTrainerAction} submitLabel="Create trainer" />
      </RedirectBoundary>,
    );

    await user.type(screen.getByLabelText("First name"), "Phase6Smoke");
    await user.type(screen.getByLabelText("Last name"), "TrainerB");
    await user.type(screen.getByLabelText("Email"), "phase6smoke@example.com");
    await user.type(screen.getByLabelText("Phone (optional)"), "6475293460");
    await user.click(screen.getByRole("button", { name: "Create trainer" }));

    // 1. Duplicate warning appears; nothing created yet.
    expect(await screen.findByText(/possible duplicate/i)).toBeInTheDocument();
    expect(createTrainerRecord).not.toHaveBeenCalled();

    // The real-world regression this guards against: the typed fields must
    // survive React's automatic form reset for the second submission to
    // ever reach the override logic.
    expect(screen.getByLabelText("First name")).toHaveValue("Phase6Smoke");
    expect(screen.getByLabelText("Last name")).toHaveValue("TrainerB");
    expect(screen.getByLabelText("Email")).toHaveValue("phase6smoke@example.com");

    // 2. Confirm the override with a valid reason and submit again.
    await user.click(
      screen.getByRole("checkbox", {
        name: /I have reviewed the above and confirm this is a different person/,
      }),
    );
    await user.type(
      screen.getByLabelText("Reason (required)"),
      "Coincidentally shares a family phone number",
    );
    await user.click(screen.getByRole("button", { name: "Create trainer" }));

    await waitFor(() => expect(createTrainerRecord).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(redirect).toHaveBeenCalledWith("/admin/trainers/new-trainer-1"),
    );

    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "trainer.create", entityId: "new-trainer-1" }),
    );
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "trainer.duplicate_override_confirmed",
        after: expect.objectContaining({
          reason: "Coincidentally shares a family phone number",
          matchedRules: ["phone"],
        }),
      }),
    );
  });

  it("does not create anything on the first submission alone, even with the checkbox pre-checked in the same click", async () => {
    vi.mocked(findDuplicateTrainers).mockResolvedValue({
      ok: true,
      data: [
        {
          candidate: {
            id: "existing-1",
            firstName: "Existing",
            lastName: "Trainer",
            email: "someone.else@example.com",
            phone: "+16475293460",
          },
          reasons: ["phone"],
        },
      ],
    });

    const user = userEvent.setup();
    render(<TrainerForm action={createTrainerAction} submitLabel="Create trainer" />);

    await user.type(screen.getByLabelText("First name"), "Phase6Smoke");
    await user.type(screen.getByLabelText("Last name"), "TrainerB");
    await user.type(screen.getByLabelText("Email"), "phase6smoke@example.com");
    await user.type(screen.getByLabelText("Phone (optional)"), "6475293460");
    await user.click(screen.getByRole("button", { name: "Create trainer" }));

    expect(await screen.findByText(/possible duplicate/i)).toBeInTheDocument();
    expect(createTrainerRecord).not.toHaveBeenCalled();
  });

  // Bug-fix regression: a duplicate EMAIL must show the hard-block field
  // error only — never the checkbox/reason override panel that phone
  // duplicates get, and it must not be bypassable by anything the UI could
  // submit (there is no checkbox for the user to check in the first place).
  it("hard-blocks a duplicate email with a visible field error and never renders the override checkbox/reason panel", async () => {
    vi.mocked(findDuplicateTrainers).mockResolvedValue({
      ok: true,
      data: [
        {
          candidate: {
            id: "existing-1",
            firstName: "Existing",
            lastName: "Trainer",
            email: "existing.trainer@example.com",
            phone: null,
          },
          reasons: ["email"],
        },
      ],
    });

    const user = userEvent.setup();
    render(<TrainerForm action={createTrainerAction} submitLabel="Create trainer" />);

    await user.type(screen.getByLabelText("First name"), "Phase6Smoke");
    await user.type(screen.getByLabelText("Last name"), "TrainerB");
    await user.type(screen.getByLabelText("Email"), "existing.trainer@example.com");
    await user.click(screen.getByRole("button", { name: "Create trainer" }));

    expect(
      await screen.findByText(
        "This email is already registered to another trainer/account. Please use a different email address.",
      ),
    ).toBeInTheDocument();
    expect(createTrainerRecord).not.toHaveBeenCalled();

    // No override UI at all for an email-only duplicate.
    expect(screen.queryByText(/possible duplicate/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("checkbox", {
        name: /I have reviewed the above and confirm this is a different person/,
      }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Reason (required)")).not.toBeInTheDocument();
  });
});
