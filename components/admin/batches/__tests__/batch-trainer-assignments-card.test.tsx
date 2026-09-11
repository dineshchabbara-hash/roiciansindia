import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * Drives the REAL BatchTrainerAssignmentsCard + real assignTrainerAction/
 * unassignTrainerAction through real submissions, only mocking the true
 * I/O boundary — mirrors components/admin/programs/__tests__/program-form.test.tsx's
 * pattern.
 */

vi.mock("@/lib/auth/session", () => ({
  getCurrentUserContext: vi.fn(),
}));

vi.mock("@/lib/data/batches", () => ({
  assignTrainerToBatch: vi.fn(),
  findExistingAssignment: vi.fn(),
  unassignTrainerFromBatch: vi.fn(),
}));

vi.mock("@/lib/data/audit-log", () => ({
  writeAuditLog: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { BatchTrainerAssignmentsCard } from "@/components/admin/batches/batch-trainer-assignments-card";
import { getCurrentUserContext } from "@/lib/auth/session";
import {
  assignTrainerToBatch,
  findExistingAssignment,
  unassignTrainerFromBatch,
} from "@/lib/data/batches";

const adminContext = {
  authUserId: "admin-auth-1",
  email: "admin@example.com",
  role: "admin" as const,
  profileId: "admin-profile-1",
  displayName: "Test Admin",
};

const TRAINER_1 = "11111111-1111-4111-8111-111111111111";
const TRAINER_2 = "22222222-2222-4222-8222-222222222222";

describe("BatchTrainerAssignmentsCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCurrentUserContext).mockResolvedValue(adminContext);
    vi.mocked(findExistingAssignment).mockResolvedValue({ ok: true, data: false });
    vi.mocked(assignTrainerToBatch).mockResolvedValue({ ok: true, data: null });
    vi.mocked(unassignTrainerFromBatch).mockResolvedValue({ ok: true, data: null });
  });

  it("shows an empty state and only assigned trainers appear as assignable-excluded", () => {
    render(
      <BatchTrainerAssignmentsCard
        batchId="batch-1"
        assignments={[]}
        trainerOptions={[
          { id: TRAINER_1, firstName: "Asha", lastName: "Rao", status: "active" },
        ]}
      />,
    );
    expect(screen.getByText("No trainers assigned yet.")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Asha Rao" })).toBeInTheDocument();
  });

  it("renders multiple assigned trainers (many-to-many), marking the primary one and inactive status", () => {
    render(
      <BatchTrainerAssignmentsCard
        batchId="batch-1"
        assignments={[
          {
            trainerId: TRAINER_1,
            firstName: "Asha",
            lastName: "Rao",
            status: "active",
            isPrimary: true,
          },
          {
            trainerId: TRAINER_2,
            firstName: "Priya",
            lastName: "Sharma",
            status: "inactive",
            isPrimary: false,
          },
        ]}
        trainerOptions={[]}
      />,
    );
    expect(screen.getByText("Asha Rao")).toBeInTheDocument();
    expect(screen.getByText("Priya Sharma")).toBeInTheDocument();
    expect(screen.getByText("Primary")).toBeInTheDocument();
    expect(screen.getByText("Inactive")).toBeInTheDocument();
  });

  it("excludes already-assigned trainers from the assignable dropdown", () => {
    render(
      <BatchTrainerAssignmentsCard
        batchId="batch-1"
        assignments={[
          {
            trainerId: TRAINER_1,
            firstName: "Asha",
            lastName: "Rao",
            status: "active",
            isPrimary: false,
          },
        ]}
        trainerOptions={[
          { id: TRAINER_1, firstName: "Asha", lastName: "Rao", status: "active" },
          { id: TRAINER_2, firstName: "Priya", lastName: "Sharma", status: "active" },
        ]}
      />,
    );
    expect(screen.queryByRole("option", { name: "Asha Rao" })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Priya Sharma" })).toBeInTheDocument();
  });

  it("shows an inactive trainer in the assignable dropdown, labeled, rather than hiding it", () => {
    render(
      <BatchTrainerAssignmentsCard
        batchId="batch-1"
        assignments={[]}
        trainerOptions={[
          { id: TRAINER_1, firstName: "Asha", lastName: "Rao", status: "inactive" },
        ]}
      />,
    );
    expect(
      screen.getByRole("option", { name: "Asha Rao (inactive)" }),
    ).toBeInTheDocument();
  });

  it("assigns the selected trainer with isPrimary and never calls assign for a duplicate", async () => {
    const user = userEvent.setup();
    render(
      <BatchTrainerAssignmentsCard
        batchId="batch-1"
        assignments={[]}
        trainerOptions={[
          { id: TRAINER_1, firstName: "Asha", lastName: "Rao", status: "active" },
        ]}
      />,
    );

    await user.selectOptions(screen.getByLabelText("Assign trainer"), TRAINER_1);
    await user.click(screen.getByLabelText("Primary trainer"));
    await user.click(screen.getByRole("button", { name: "Assign" }));

    await vi.waitFor(() =>
      expect(assignTrainerToBatch).toHaveBeenCalledWith("batch-1", TRAINER_1, true),
    );
  });

  it("blocks a duplicate assignment with a visible error and never calls assign", async () => {
    vi.mocked(findExistingAssignment).mockResolvedValue({ ok: true, data: true });
    const user = userEvent.setup();
    render(
      <BatchTrainerAssignmentsCard
        batchId="batch-1"
        assignments={[]}
        trainerOptions={[
          { id: TRAINER_1, firstName: "Asha", lastName: "Rao", status: "active" },
        ]}
      />,
    );

    await user.selectOptions(screen.getByLabelText("Assign trainer"), TRAINER_1);
    await user.click(screen.getByRole("button", { name: "Assign" }));

    expect(
      await screen.findByText("This trainer is already assigned to this batch."),
    ).toBeInTheDocument();
    expect(assignTrainerToBatch).not.toHaveBeenCalled();
  });

  it("unassigns a trainer via the Unassign button", async () => {
    const user = userEvent.setup();
    render(
      <BatchTrainerAssignmentsCard
        batchId="batch-1"
        assignments={[
          {
            trainerId: TRAINER_1,
            firstName: "Asha",
            lastName: "Rao",
            status: "active",
            isPrimary: false,
          },
        ]}
        trainerOptions={[]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Unassign" }));

    await vi.waitFor(() =>
      expect(unassignTrainerFromBatch).toHaveBeenCalledWith("batch-1", TRAINER_1),
    );
  });
});
