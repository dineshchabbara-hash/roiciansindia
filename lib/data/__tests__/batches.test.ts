import { describe, expect, it, vi, beforeEach } from "vitest";

// See lib/data/__tests__/trainers.test.ts for why `server-only` itself must
// be mocked to import the real data-layer module under Vitest.
vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  assignTrainerToBatch,
  createBatchRecord,
  findExistingAssignment,
  getBatchTrainerAssignments,
  searchBatches,
  unassignTrainerFromBatch,
  updateBatchProfile,
} from "@/lib/data/batches";
import type { BatchProfileInput } from "@/lib/validation/batches";

function baseInput(): BatchProfileInput {
  return {
    programId: "11111111-1111-4111-8111-111111111111",
    name: "September 2026 Weekend Batch",
    startDate: "2026-09-01",
    expectedEndDate: null,
    daysOfWeek: ["sat", "sun"],
    startTime: "09:00",
    endTime: "17:00",
    timezone: "Asia/Kolkata",
    deliveryMode: "online",
    capacity: 30,
    meetingLink: null,
    location: null,
    notes: null,
  };
}

describe("createBatchRecord", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("inserts the batch and returns its id", async () => {
    const single = vi.fn().mockResolvedValue({ data: { id: "batch-1" }, error: null });
    const select = vi.fn().mockReturnValue({ single });
    const insert = vi.fn().mockReturnValue({ select });
    const from = vi.fn().mockReturnValue({ insert });
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from } as never);

    const result = await createBatchRecord(baseInput());

    expect(result).toEqual({ ok: true, data: { id: "batch-1" } });
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        program_id: "11111111-1111-4111-8111-111111111111",
        name: "September 2026 Weekend Batch",
        days_of_week: ["sat", "sun"],
      }),
    );
  });

  it("translates a foreign_key_violation on program_id into a clear error", async () => {
    const single = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "23503", message: "insert or update violates foreign key" },
    });
    const select = vi.fn().mockReturnValue({ single });
    const insert = vi.fn().mockReturnValue({ select });
    const from = vi.fn().mockReturnValue({ insert });
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from } as never);

    const result = await createBatchRecord(baseInput());

    expect(result).toEqual({
      ok: false,
      error: "Selected program could not be found. Please choose a valid program.",
    });
  });

  it("surfaces an unrelated DB error as a generic message", async () => {
    const single = vi
      .fn()
      .mockResolvedValue({ data: null, error: new Error("connection reset") });
    const select = vi.fn().mockReturnValue({ single });
    const insert = vi.fn().mockReturnValue({ select });
    const from = vi.fn().mockReturnValue({ insert });
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from } as never);

    const result = await createBatchRecord(baseInput());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("Could not create the batch. Please try again.");
    }
  });
});

describe("updateBatchProfile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("never writes program_id — Program reassignment is not exposed in Phase 8", async () => {
    const eq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ update });
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from } as never);

    const result = await updateBatchProfile("batch-1", {
      ...baseInput(),
      name: "Renamed Batch",
    });

    expect(result).toEqual({ ok: true, data: null });
    const updatePayload = update.mock.calls[0][0];
    expect(updatePayload).not.toHaveProperty("program_id");
    expect(updatePayload.name).toBe("Renamed Batch");
  });
});

describe("searchBatches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves matching batch ids from batch_trainers first when filtering by trainer, never duplicating rows via a join", async () => {
    const assignmentEq = vi.fn().mockResolvedValue({
      data: [{ batch_id: "batch-1" }, { batch_id: "batch-2" }],
      error: null,
    });
    const assignmentSelect = vi.fn().mockReturnValue({ eq: assignmentEq });

    const order = vi.fn().mockReturnValue({
      range: vi.fn().mockResolvedValue({
        data: [
          {
            id: "batch-1",
            name: "Batch One",
            program_id: "program-1",
            start_date: "2026-09-01",
            expected_end_date: null,
            status: "active",
            capacity: 30,
            program: { name: "Program One" },
          },
        ],
        error: null,
        count: 1,
      }),
    });
    const inFn = vi.fn().mockReturnValue({ order });
    const batchesSelect = vi.fn().mockReturnValue({ in: inFn });

    const from = vi.fn((table: string) => {
      if (table === "batch_trainers") return { select: assignmentSelect };
      if (table === "batches") return { select: batchesSelect };
      throw new Error(`Unexpected table: ${table}`);
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from } as never);

    const result = await searchBatches({ trainerId: "trainer-1" });

    expect(assignmentEq).toHaveBeenCalledWith("trainer_id", "trainer-1");
    expect(inFn).toHaveBeenCalledWith("id", ["batch-1", "batch-2"]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.total).toBe(1);
      expect(result.data.batches).toHaveLength(1);
    }
  });

  it("short-circuits to an empty page when the trainer has no assignments at all, without querying batches", async () => {
    const assignmentEq = vi.fn().mockResolvedValue({ data: [], error: null });
    const assignmentSelect = vi.fn().mockReturnValue({ eq: assignmentEq });
    const batchesSelect = vi.fn();

    const from = vi.fn((table: string) => {
      if (table === "batch_trainers") return { select: assignmentSelect };
      if (table === "batches") return { select: batchesSelect };
      throw new Error(`Unexpected table: ${table}`);
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from } as never);

    const result = await searchBatches({ trainerId: "trainer-with-no-batches" });

    expect(result).toEqual({
      ok: true,
      data: { batches: [], total: 0, page: 1, pageSize: 20 },
    });
    expect(batchesSelect).not.toHaveBeenCalled();
  });
});

describe("getBatchTrainerAssignments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns multiple trainers for one batch, proving many-to-many support", async () => {
    const eq = vi.fn().mockResolvedValue({
      data: [
        {
          trainer_id: "trainer-1",
          is_primary: true,
          trainer: { first_name: "Asha", last_name: "Rao", status: "active" },
        },
        {
          trainer_id: "trainer-2",
          is_primary: false,
          trainer: { first_name: "Priya", last_name: "Sharma", status: "inactive" },
        },
      ],
      error: null,
    });
    const select = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ select });
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from } as never);

    const result = await getBatchTrainerAssignments("batch-1");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveLength(2);
      expect(result.data[0]).toEqual({
        trainerId: "trainer-1",
        firstName: "Asha",
        lastName: "Rao",
        status: "active",
        isPrimary: true,
      });
      expect(result.data[1].status).toBe("inactive");
    }
  });
});

describe("findExistingAssignment / assignTrainerToBatch / unassignTrainerFromBatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("findExistingAssignment returns true when a row already exists", async () => {
    const maybeSingle = vi
      .fn()
      .mockResolvedValue({ data: { id: "assignment-1" }, error: null });
    const eq2 = vi.fn().mockReturnValue({ maybeSingle });
    const eq1 = vi.fn().mockReturnValue({ eq: eq2 });
    const select = vi.fn().mockReturnValue({ eq: eq1 });
    const from = vi.fn().mockReturnValue({ select });
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from } as never);

    const result = await findExistingAssignment("batch-1", "trainer-1");
    expect(result).toEqual({ ok: true, data: true });
  });

  it("assignTrainerToBatch translates a unique_violation into a clear duplicate-assignment error", async () => {
    const insert = vi
      .fn()
      .mockResolvedValue({ error: { code: "23505", message: "duplicate key value" } });
    const from = vi.fn().mockReturnValue({ insert });
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from } as never);

    const result = await assignTrainerToBatch("batch-1", "trainer-1", false);
    expect(result).toEqual({
      ok: false,
      error: "This trainer is already assigned to this batch.",
    });
  });

  it("assignTrainerToBatch inserts is_primary exactly as given", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn().mockReturnValue({ insert });
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from } as never);

    await assignTrainerToBatch("batch-1", "trainer-1", true);
    expect(insert).toHaveBeenCalledWith({
      batch_id: "batch-1",
      trainer_id: "trainer-1",
      is_primary: true,
    });
  });

  it("unassignTrainerFromBatch deletes scoped to both batch_id and trainer_id", async () => {
    const eq2 = vi.fn().mockResolvedValue({ error: null });
    const eq1 = vi.fn().mockReturnValue({ eq: eq2 });
    const del = vi.fn().mockReturnValue({ eq: eq1 });
    const from = vi.fn().mockReturnValue({ delete: del });
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from } as never);

    const result = await unassignTrainerFromBatch("batch-1", "trainer-1");
    expect(result).toEqual({ ok: true, data: null });
    expect(eq1).toHaveBeenCalledWith("batch_id", "batch-1");
    expect(eq2).toHaveBeenCalledWith("trainer_id", "trainer-1");
  });
});
