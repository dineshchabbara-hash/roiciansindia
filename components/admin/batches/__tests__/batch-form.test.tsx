import { Component, type ReactNode } from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * Mirrors components/admin/programs/__tests__/program-form.test.tsx's
 * pattern: drive the REAL BatchForm + real createBatchAction/
 * updateBatchAction through real submissions, only mocking the true I/O
 * boundary, proving:
 *  1. a validation failure must not clear the form (React 19's automatic
 *     uncontrolled-field reset, same bug class as Student/Trainer/Program).
 *  2. the edit form renders Program as immutable/read-only.
 */

vi.mock("@/lib/auth/session", () => ({
  getCurrentUserContext: vi.fn(),
}));

vi.mock("@/lib/data/batches", () => ({
  createBatchRecord: vi.fn(),
  getBatchProfile: vi.fn(),
  updateBatchProfile: vi.fn(),
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

import { BatchForm } from "@/components/admin/batches/batch-form";
import { createBatchAction, updateBatchAction } from "@/lib/actions/batches";
import { getCurrentUserContext } from "@/lib/auth/session";
import {
  createBatchRecord,
  getBatchProfile,
  updateBatchProfile,
} from "@/lib/data/batches";
import { redirect } from "next/navigation";

const adminContext = {
  authUserId: "admin-auth-1",
  email: "admin@example.com",
  role: "admin" as const,
  profileId: "admin-profile-1",
  displayName: "Test Admin",
};

const programOptions = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Full Stack Development",
    programCode: "FSD-101",
  },
];

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

describe("BatchForm + createBatchAction: validation failure preserves the form", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCurrentUserContext).mockResolvedValue(adminContext);
  });

  it("keeps every typed field after a date-range validation error instead of clearing the form", async () => {
    const user = userEvent.setup();
    render(
      <RedirectBoundary>
        <BatchForm
          action={createBatchAction}
          programOptions={programOptions}
          submitLabel="Create batch"
        />
      </RedirectBoundary>,
    );

    await user.selectOptions(
      screen.getByLabelText("Program"),
      "11111111-1111-4111-8111-111111111111",
    );
    await user.type(screen.getByLabelText("Batch name"), "September 2026 Weekend Batch");
    await user.type(screen.getByLabelText("Start date"), "2026-09-01");
    await user.type(screen.getByLabelText("Expected end date (optional)"), "2026-08-01");
    await user.click(screen.getByRole("button", { name: "Create batch" }));

    expect(
      await screen.findByText(/cannot be before the start date/i),
    ).toBeInTheDocument();
    expect(createBatchRecord).not.toHaveBeenCalled();

    expect(screen.getByLabelText("Batch name")).toHaveValue(
      "September 2026 Weekend Batch",
    );
    expect(screen.getByLabelText("Start date")).toHaveValue("2026-09-01");
    expect(screen.getByLabelText("Expected end date (optional)")).toHaveValue(
      "2026-08-01",
    );
  });
});

describe("BatchForm on edit: Program is immutable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCurrentUserContext).mockResolvedValue(adminContext);
    vi.mocked(updateBatchProfile).mockResolvedValue({ ok: true, data: null });
  });

  const defaultValues = {
    programId: "11111111-1111-4111-8111-111111111111",
    programName: "Full Stack Development",
    programCode: "FSD-101",
    name: "September 2026 Weekend Batch",
    startDate: "2026-09-01",
    expectedEndDate: null,
    daysOfWeek: [] as string[],
    startTime: null,
    endTime: null,
    timezone: "Asia/Kolkata",
    deliveryMode: null,
    capacity: null,
    meetingLink: null,
    location: null,
    notes: null,
  };

  it("renders the program as read-only and never lets it be reassigned", () => {
    render(
      <BatchForm
        action={updateBatchAction.bind(null, "batch-1")}
        defaultValues={defaultValues}
        programOptions={programOptions}
        submitLabel="Save changes"
      />,
    );

    const programInput = screen.getByLabelText("Program") as HTMLInputElement;
    expect(programInput).toHaveValue("Full Stack Development (FSD-101)");
    expect(programInput).toHaveAttribute("readonly");
    // No <select> for Program on the edit form at all.
    expect(screen.queryByRole("combobox", { name: "Program" })).not.toBeInTheDocument();
  });

  it("submits the (unchanged) program id alongside an edited name without error", async () => {
    vi.mocked(getBatchProfile).mockResolvedValue({
      ok: true,
      data: {
        id: "batch-1",
        status: "draft",
        createdAt: "2026-01-01T00:00:00.000Z",
        ...defaultValues,
      },
    });

    const user = userEvent.setup();
    render(
      <RedirectBoundary>
        <BatchForm
          action={updateBatchAction.bind(null, "batch-1")}
          defaultValues={defaultValues}
          programOptions={programOptions}
          submitLabel="Save changes"
        />
      </RedirectBoundary>,
    );

    const nameInput = screen.getByLabelText("Batch name");
    await user.clear(nameInput);
    await user.type(nameInput, "September 2026 Weekend Batch (Updated)");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await vi.waitFor(() =>
      expect(redirect).toHaveBeenCalledWith("/admin/batches/batch-1"),
    );
    expect(updateBatchProfile).toHaveBeenCalledWith(
      "batch-1",
      expect.objectContaining({
        programId: "11111111-1111-4111-8111-111111111111",
        name: "September 2026 Weekend Batch (Updated)",
      }),
    );
  });
});
