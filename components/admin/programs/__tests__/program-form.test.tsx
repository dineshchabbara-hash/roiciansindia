import { Component, type ReactNode } from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * Mirrors components/admin/trainers/__tests__/trainer-form-duplicate-override-flow.test.tsx's
 * pattern: drive the REAL ProgramForm + real createProgramAction/
 * updateProgramAction through real submissions, only mocking the true I/O
 * boundary, proving two things the spec calls out explicitly:
 *  1. a validation/duplicate failure must not clear the form (React 19's
 *     automatic uncontrolled-field reset, same bug class as Student/Trainer).
 *  2. the edit form renders the program code as immutable/read-only.
 */

vi.mock("@/lib/auth/session", () => ({
  getCurrentUserContext: vi.fn(),
}));

vi.mock("@/lib/data/programs", () => ({
  createProgramRecord: vi.fn(),
  findProgramByExactCode: vi.fn(),
  getProgramCodePattern: vi.fn(),
  getProgramProfile: vi.fn(),
  updateProgramProfile: vi.fn(),
  updateProgramStatus: vi.fn(),
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

import { ProgramForm } from "@/components/admin/programs/program-form";
import { createProgramAction, updateProgramAction } from "@/lib/actions/programs";
import { getCurrentUserContext } from "@/lib/auth/session";
import {
  createProgramRecord,
  findProgramByExactCode,
  getProgramCodePattern,
  getProgramProfile,
  updateProgramProfile,
} from "@/lib/data/programs";
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

describe("ProgramForm + createProgramAction: duplicate-code failure preserves the form", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCurrentUserContext).mockResolvedValue(adminContext);
    vi.mocked(getProgramCodePattern).mockResolvedValue({ ok: true, data: null });
  });

  it("keeps every typed field after a duplicate-code error instead of clearing the form", async () => {
    vi.mocked(findProgramByExactCode).mockResolvedValue({
      ok: true,
      data: { id: "existing-1", name: "Existing Program" },
    });

    const user = userEvent.setup();
    render(
      <RedirectBoundary>
        <ProgramForm action={createProgramAction} submitLabel="Create program" />
      </RedirectBoundary>,
    );

    await user.type(screen.getByLabelText("Program code"), "FSD-101");
    await user.type(screen.getByLabelText("Program name"), "Full Stack Development");
    await user.type(screen.getByLabelText("Regular fee (INR)"), "50000");
    await user.click(screen.getByRole("button", { name: "Create program" }));

    expect(
      await screen.findByText(/already used by "Existing Program"/),
    ).toBeInTheDocument();
    expect(createProgramRecord).not.toHaveBeenCalled();

    // The real-world regression this guards against: React 19 resets
    // uncontrolled <form action> fields once the action resolves — the
    // generation-keyed Fragment in ProgramForm must survive that.
    expect(screen.getByLabelText("Program code")).toHaveValue("FSD-101");
    expect(screen.getByLabelText("Program name")).toHaveValue("Full Stack Development");
    // Regular fee is now a type="number" input (see the money-precision fix
    // in program-form.tsx) — jest-dom's toHaveValue compares it as a number.
    expect(screen.getByLabelText("Regular fee (INR)")).toHaveValue(50000);
  });

  // Regression coverage for the real Phase 7 money-precision bug: a decimal
  // fee must survive a validation-failure round trip exactly, not just a
  // whole number.
  it("keeps an exact decimal fee (e.g. 500.50) after a duplicate-code error", async () => {
    vi.mocked(findProgramByExactCode).mockResolvedValue({
      ok: true,
      data: { id: "existing-1", name: "Existing Program" },
    });

    const user = userEvent.setup();
    render(
      <RedirectBoundary>
        <ProgramForm action={createProgramAction} submitLabel="Create program" />
      </RedirectBoundary>,
    );

    await user.type(screen.getByLabelText("Program code"), "FSD-101");
    await user.type(screen.getByLabelText("Program name"), "Full Stack Development");
    await user.type(screen.getByLabelText("Regular fee (INR)"), "500.50");
    await user.click(screen.getByRole("button", { name: "Create program" }));

    expect(
      await screen.findByText(/already used by "Existing Program"/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Regular fee (INR)")).toHaveValue(500.5);
  });
});

describe("ProgramForm on edit: program code is immutable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCurrentUserContext).mockResolvedValue(adminContext);
    vi.mocked(updateProgramProfile).mockResolvedValue({ ok: true, data: null });
    vi.mocked(getProgramProfile).mockResolvedValue({
      ok: true,
      data: {
        id: "program-1",
        programCode: "FSD-101",
        name: "Full Stack Development",
        description: null,
        category: null,
        durationValue: null,
        durationUnit: null,
        deliveryMode: null,
        regularFee: "50000",
        registrationFee: "0",
        taxRatePercent: null,
        status: "draft",
        certificateEligible: true,
        installmentsAllowed: true,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    });
  });

  const defaultValues = {
    programCode: "FSD-101",
    name: "Full Stack Development",
    description: null,
    category: null,
    durationValue: null,
    durationUnit: null,
    deliveryMode: null,
    regularFee: "50000",
    registrationFee: "0",
    taxRatePercent: null,
    certificateEligible: true,
    installmentsAllowed: true,
  };

  it("renders the program code as read-only and never lets it be edited", () => {
    render(
      <ProgramForm
        action={updateProgramAction.bind(null, "program-1")}
        defaultValues={defaultValues}
        submitLabel="Save changes"
      />,
    );

    const codeInput = screen.getByLabelText("Program code") as HTMLInputElement;
    expect(codeInput).toHaveValue("FSD-101");
    expect(codeInput).toHaveAttribute("readonly");
  });

  it("submits the (unchanged, read-only) code alongside an edited name without error", async () => {
    const user = userEvent.setup();
    render(
      <RedirectBoundary>
        <ProgramForm
          action={updateProgramAction.bind(null, "program-1")}
          defaultValues={defaultValues}
          submitLabel="Save changes"
        />
      </RedirectBoundary>,
    );

    const nameInput = screen.getByLabelText("Program name");
    await user.clear(nameInput);
    await user.type(nameInput, "Full Stack Development (Updated)");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await vi.waitFor(() =>
      expect(redirect).toHaveBeenCalledWith("/admin/programs/program-1"),
    );
    expect(updateProgramProfile).toHaveBeenCalledWith(
      "program-1",
      expect.objectContaining({ name: "Full Stack Development (Updated)" }),
    );
  });
});
