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

  it("assignTrainerToBatch inserts is_primary exactly as given, then demotes every other trainer on the batch", async () => {
    // No existing primary for this pre-check.
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const selectEq2 = vi.fn().mockReturnValue({ maybeSingle });
    const selectEq1 = vi.fn().mockReturnValue({ eq: selectEq2 });
    const select = vi.fn().mockReturnValue({ eq: selectEq1 });

    const insert = vi.fn().mockResolvedValue({ error: null });

    const updateNeq = vi.fn().mockResolvedValue({ error: null });
    const updateEq = vi.fn().mockReturnValue({ neq: updateNeq });
    const update = vi.fn().mockReturnValue({ eq: updateEq });

    const from = vi.fn().mockReturnValue({ select, insert, update });
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from } as never);

    const result = await assignTrainerToBatch("batch-1", "trainer-1", true);

    expect(insert).toHaveBeenCalledWith({
      batch_id: "batch-1",
      trainer_id: "trainer-1",
      is_primary: true,
    });
    expect(update).toHaveBeenCalledWith({ is_primary: false });
    expect(updateEq).toHaveBeenCalledWith("batch_id", "batch-1");
    expect(updateNeq).toHaveBeenCalledWith("trainer_id", "trainer-1");
    expect(result).toEqual({ ok: true, data: { previousPrimaryTrainerId: null } });
  });

  it("assignTrainerToBatch does not query for or demote anyone when isPrimary is false", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const select = vi.fn();
    const update = vi.fn();
    const from = vi.fn().mockReturnValue({ select, insert, update });
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from } as never);

    const result = await assignTrainerToBatch("batch-1", "trainer-1", false);

    expect(insert).toHaveBeenCalledWith({
      batch_id: "batch-1",
      trainer_id: "trainer-1",
      is_primary: false,
    });
    expect(select).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, data: { previousPrimaryTrainerId: null } });
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

  it("assignTrainerToBatch reports the previously-Primary trainer for the audit event", async () => {
    const maybeSingle = vi
      .fn()
      .mockResolvedValue({ data: { trainer_id: "trainer-old-primary" }, error: null });
    const selectEq2 = vi.fn().mockReturnValue({ maybeSingle });
    const selectEq1 = vi.fn().mockReturnValue({ eq: selectEq2 });
    const select = vi.fn().mockReturnValue({ eq: selectEq1 });

    const insert = vi.fn().mockResolvedValue({ error: null });

    const updateNeq = vi.fn().mockResolvedValue({ error: null });
    const updateEq = vi.fn().mockReturnValue({ neq: updateNeq });
    const update = vi.fn().mockReturnValue({ eq: updateEq });

    const from = vi.fn().mockReturnValue({ select, insert, update });
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from } as never);

    const result = await assignTrainerToBatch("batch-1", "trainer-new-primary", true);

    expect(result).toEqual({
      ok: true,
      data: { previousPrimaryTrainerId: "trainer-old-primary" },
    });
  });

  it("rolls back the just-inserted assignment if the demote step fails, never leaving two Primaries or a half-applied state", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const selectEq2 = vi.fn().mockReturnValue({ maybeSingle });
    const selectEq1 = vi.fn().mockReturnValue({ eq: selectEq2 });
    const select = vi.fn().mockReturnValue({ eq: selectEq1 });

    const insert = vi.fn().mockResolvedValue({ error: null });

    const updateNeq = vi
      .fn()
      .mockResolvedValue({ error: new Error("demote update failed") });
    const updateEq = vi.fn().mockReturnValue({ neq: updateNeq });
    const update = vi.fn().mockReturnValue({ eq: updateEq });

    const deleteEq2 = vi.fn().mockResolvedValue({ error: null });
    const deleteEq1 = vi.fn().mockReturnValue({ eq: deleteEq2 });
    const del = vi.fn().mockReturnValue({ eq: deleteEq1 });

    const from = vi.fn().mockReturnValue({ select, insert, update, delete: del });
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from } as never);

    const result = await assignTrainerToBatch("batch-1", "trainer-1", true);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("Could not assign the trainer. Please try again.");
    }
    // Rollback: the just-inserted row is deleted rather than left behind
    // alongside whichever trainer the failed demote couldn't touch.
    expect(del).toHaveBeenCalled();
    expect(deleteEq1).toHaveBeenCalledWith("batch_id", "batch-1");
    expect(deleteEq2).toHaveBeenCalledWith("trainer_id", "trainer-1");
  });

  // Concurrency analysis for the bug report (Phase 8 Primary-Trainer
  // report, Checkpoint 3). Uses a small in-memory fake so both the
  // realistic case and the proven residual gap can be demonstrated against
  // the REAL assignTrainerToBatch function, not just reasoned about.
  describe("concurrency", () => {
    type Row = { batch_id: string; trainer_id: string; is_primary: boolean };

    function makeSequentialFake(rows: Row[]) {
      return vi.fn((table: string) => {
        if (table !== "batch_trainers") throw new Error(`Unexpected table: ${table}`);
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => {
                  const existing = rows.find((r) => r.is_primary);
                  return {
                    data: existing ? { trainer_id: existing.trainer_id } : null,
                    error: null,
                  };
                },
              }),
            }),
          }),
          insert: async (row: Row) => {
            rows.push({ ...row });
            return { error: null };
          },
          update: (patch: { is_primary: boolean }) => ({
            eq: () => ({
              neq: async (_col: string, excludeTrainerId: string) => {
                for (const r of rows) {
                  if (r.trainer_id !== excludeTrainerId) r.is_primary = patch.is_primary;
                }
                return { error: null };
              },
            }),
          }),
        };
      });
    }

    it("guarantees exactly one Primary for any sequence of non-overlapping calls — the realistic case, since the UI disables Assign while a request is pending", async () => {
      const rows: Row[] = [];
      vi.mocked(createSupabaseServerClient).mockResolvedValue({
        from: makeSequentialFake(rows),
      } as never);

      await assignTrainerToBatch("batch-1", "trainer-A", true);
      expect(rows.filter((r) => r.is_primary).map((r) => r.trainer_id)).toEqual([
        "trainer-A",
      ]);

      await assignTrainerToBatch("batch-1", "trainer-B", false);
      expect(rows.filter((r) => r.is_primary).map((r) => r.trainer_id)).toEqual([
        "trainer-A",
      ]);

      await assignTrainerToBatch("batch-1", "trainer-C", true);
      expect(rows.filter((r) => r.is_primary).map((r) => r.trainer_id)).toEqual([
        "trainer-C",
      ]);
      expect(rows).toHaveLength(3); // no assignment row was lost
    });

    it("documents the proven residual gap: two calls truly in flight at once can wipe out both Primary flags — this is exactly why a DB-level fix needs approval before implementation, not a passing guarantee this fix makes", async () => {
      const rows: Row[] = [];

      function deferred() {
        let resolve!: () => void;
        const promise = new Promise<void>((r) => (resolve = r));
        return { promise, resolve };
      }
      const insertGateA = deferred();
      const insertGateC = deferred();
      const demoteGateA = deferred();
      const demoteGateC = deferred();

      const from = vi.fn((table: string) => {
        if (table !== "batch_trainers") throw new Error(`Unexpected table: ${table}`);
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: null, error: null }),
              }),
            }),
          }),
          insert: (row: Row) => {
            const gate = row.trainer_id === "trainer-A" ? insertGateA : insertGateC;
            return gate.promise.then(() => {
              rows.push({ ...row });
              return { error: null };
            });
          },
          update: (patch: { is_primary: boolean }) => ({
            eq: () => ({
              neq: (_col: string, excludeTrainerId: string) => {
                const gate = excludeTrainerId === "trainer-A" ? demoteGateA : demoteGateC;
                return gate.promise.then(() => {
                  for (const r of rows) {
                    if (r.trainer_id !== excludeTrainerId)
                      r.is_primary = patch.is_primary;
                  }
                  return { error: null };
                });
              },
            }),
          }),
        };
      });
      vi.mocked(createSupabaseServerClient).mockResolvedValue({ from } as never);

      const callA = assignTrainerToBatch("batch-1", "trainer-A", true);
      const callC = assignTrainerToBatch("batch-1", "trainer-C", true);

      // Force both inserts to land before either demote-update runs — the
      // interleaving lib/data/batches.ts's header comment describes.
      insertGateA.resolve();
      insertGateC.resolve();
      await Promise.resolve();
      await Promise.resolve();

      // Each demote-update only excludes its own target, so it demotes the
      // other request's row too — neither ever re-asserts itself
      // afterward, since a demote-update never sets anything to true.
      demoteGateA.resolve();
      demoteGateC.resolve();
      await Promise.all([callA, callC]);

      const primaryIds = rows.filter((r) => r.is_primary).map((r) => r.trainer_id);
      // This is the proven gap, not a desired outcome: each demote-update
      // only ever sets the *other* request's row to false and never
      // re-asserts its own target back to true, so whichever demote-update
      // runs second silently un-sets the first request's legitimately-primary
      // row — leaving the batch with zero Primaries, not two. Both
      // assignment rows still exist (no data loss), just neither is primary.
      // A DB-level partial unique index or an RPC-wrapped transaction is
      // required to close this; see the Phase 8 Primary-Trainer report.
      expect(primaryIds).toEqual([]);
      expect(rows.map((r) => r.trainer_id).sort()).toEqual(["trainer-A", "trainer-C"]);
    });
  });
});
