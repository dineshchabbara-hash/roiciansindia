import { describe, expect, it, vi, beforeEach } from "vitest";

// See lib/data/__tests__/trainers.test.ts for why `server-only` itself must
// be mocked to import the real data-layer module under Vitest.
vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  getMyTrainerProfile,
  getMyBatches,
  getMyBatch,
  getMyPrograms,
  getMyStudents,
  getMyStudentsForBatch,
  getMyStudent,
} from "@/lib/data/trainer-portal";

const AUTH_USER = { id: "auth-user-1" };

// Same thenable fluent builder as lib/data/__tests__/student-portal.test.ts
// (Phase 10) — select/eq/in all return itself so any combination of
// filters resolves the same way whether the caller awaits directly or
// calls `.maybeSingle()` explicitly.
function makeBuilder(resolvedValue: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {};
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.in = vi.fn(() => builder);
  builder.maybeSingle = vi.fn().mockResolvedValue(resolvedValue);
  builder.then = (onFulfilled: (value: { data: unknown; error: unknown }) => unknown) =>
    Promise.resolve(resolvedValue).then(onFulfilled);
  return builder;
}

function mockSupabase({
  authUser = AUTH_USER as { id: string } | null,
  fromTable,
  rpc,
}: {
  authUser?: { id: string } | null;
  fromTable: Record<string, unknown>;
  rpc?: { data: unknown; error: unknown };
}) {
  const client = {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: authUser } }) },
    from: vi.fn((table: string) => fromTable[table]),
    rpc: vi.fn().mockResolvedValue(rpc ?? { data: [], error: null }),
  };
  vi.mocked(createSupabaseServerClient).mockResolvedValue(
    client as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
  );
  return client;
}

describe("getMyTrainerProfile", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns not-signed-in when there is no authenticated user", async () => {
    mockSupabase({ authUser: null, fromTable: {} });
    const result = await getMyTrainerProfile();
    expect(result).toEqual({ ok: false, error: "Not signed in." });
  });

  it("scopes the query by the caller's own auth_user_id, never a supplied id", async () => {
    const trainersBuilder = makeBuilder({
      data: {
        id: "trainer-1",
        first_name: "Asha",
        last_name: "Rao",
        email: "asha@example.com",
        phone: "+919876543210",
        bio: null,
        specialization: ["Data Analytics"],
        status: "active",
      },
      error: null,
    });
    mockSupabase({ fromTable: { trainers: trainersBuilder } });

    const result = await getMyTrainerProfile();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.id).toBe("trainer-1");
      expect(result.data.specialization).toEqual(["Data Analytics"]);
    }
    expect(trainersBuilder.eq).toHaveBeenCalledWith("auth_user_id", AUTH_USER.id);
  });

  it("propagates a not-found error rather than exposing another row", async () => {
    const trainersBuilder = makeBuilder({ data: null, error: null });
    mockSupabase({ fromTable: { trainers: trainersBuilder } });

    const result = await getMyTrainerProfile();
    expect(result).toEqual({ ok: false, error: "Trainer profile not found." });
  });
});

function batchJoinRow(overrides: Record<string, unknown> = {}) {
  return {
    is_primary: true,
    batch: {
      id: "batch-1",
      name: "Batch A",
      program_id: "program-1",
      start_date: "2026-01-01",
      expected_end_date: null,
      start_time: "18:00",
      end_time: "20:00",
      days_of_week: ["Mon", "Wed"],
      timezone: "Asia/Kolkata",
      delivery_mode: "online",
      capacity: 30,
      status: "active",
      meeting_link: null,
      location: null,
      program: { program_code: "DA", name: "Data Analytics" },
    },
    ...overrides,
  };
}

describe("getMyBatches", () => {
  beforeEach(() => vi.clearAllMocks());

  it("scopes the batch list to the caller's own resolved trainer id", async () => {
    const trainersBuilder = makeBuilder({ data: { id: "trainer-1" }, error: null });
    const batchTrainersBuilder = makeBuilder({ data: [batchJoinRow()], error: null });
    mockSupabase({
      fromTable: { trainers: trainersBuilder, batch_trainers: batchTrainersBuilder },
    });

    const result = await getMyBatches();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual([
        {
          id: "batch-1",
          name: "Batch A",
          programId: "program-1",
          programCode: "DA",
          programName: "Data Analytics",
          startDate: "2026-01-01",
          expectedEndDate: null,
          startTime: "18:00",
          endTime: "20:00",
          daysOfWeek: ["Mon", "Wed"],
          timezone: "Asia/Kolkata",
          deliveryMode: "online",
          capacity: 30,
          status: "active",
          meetingLink: null,
          location: null,
          isPrimary: true,
        },
      ]);
    }
    expect(batchTrainersBuilder.eq).toHaveBeenCalledWith("trainer_id", "trainer-1");
    // Never exposes any Program pricing column (regular_fee/registration_fee/
    // tax_rate_percent) — the returned row has exactly the safe Phase 11
    // projection above, with no such keys at all.
  });

  it("never leaks another trainer's batches via a resolution failure", async () => {
    const trainersBuilder = makeBuilder({ data: null, error: null });
    mockSupabase({ fromTable: { trainers: trainersBuilder } });

    const result = await getMyBatches();
    expect(result).toEqual({ ok: false, error: "Trainer profile not found." });
  });
});

describe("getMyBatch", () => {
  beforeEach(() => vi.clearAllMocks());

  it("filters by both the requested batch id AND the caller's own trainer id", async () => {
    const trainersBuilder = makeBuilder({ data: { id: "trainer-1" }, error: null });
    const batchTrainersBuilder = makeBuilder({ data: batchJoinRow(), error: null });
    mockSupabase({
      fromTable: { trainers: trainersBuilder, batch_trainers: batchTrainersBuilder },
    });

    const result = await getMyBatch("batch-1");

    expect(result.ok).toBe(true);
    expect(batchTrainersBuilder.eq).toHaveBeenCalledWith("trainer_id", "trainer-1");
    expect(batchTrainersBuilder.eq).toHaveBeenCalledWith("batch_id", "batch-1");
  });

  it("returns the same not-found error for a nonexistent id and for an unassigned batch — never a distinct response that would confirm the id exists", async () => {
    const trainersBuilder = makeBuilder({ data: { id: "trainer-1" }, error: null });
    const batchTrainersBuilder = makeBuilder({ data: null, error: null });
    mockSupabase({
      fromTable: { trainers: trainersBuilder, batch_trainers: batchTrainersBuilder },
    });

    const result = await getMyBatch("unassigned-batch-id");
    expect(result).toEqual({ ok: false, error: "Batch not found." });
  });
});

describe("getMyPrograms", () => {
  beforeEach(() => vi.clearAllMocks());

  it("derives programs only from the caller's own assigned batches, never every published program", async () => {
    const trainersBuilder = makeBuilder({ data: { id: "trainer-1" }, error: null });
    const batchTrainersBuilder = makeBuilder({
      data: [
        { batch: { program_id: "program-1" } },
        { batch: { program_id: "program-1" } },
      ],
      error: null,
    });
    const programsBuilder = makeBuilder({
      data: [
        {
          id: "program-1",
          program_code: "DA",
          name: "Data Analytics",
          description: "desc",
          category: "Tech",
          duration_value: 12,
          duration_unit: "weeks",
          delivery_mode: "online",
          status: "active",
        },
      ],
      error: null,
    });
    mockSupabase({
      fromTable: {
        trainers: trainersBuilder,
        batch_trainers: batchTrainersBuilder,
        programs: programsBuilder,
      },
    });

    const result = await getMyPrograms();

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Deduplicated to one program despite two batches on it.
      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toEqual({
        id: "program-1",
        programCode: "DA",
        name: "Data Analytics",
        description: "desc",
        category: "Tech",
        durationValue: 12,
        durationUnit: "weeks",
        deliveryMode: "online",
        status: "active",
      });
      // Never a fee field on the returned row.
      expect(result.data[0]).not.toHaveProperty("regularFee");
      expect(result.data[0]).not.toHaveProperty("registrationFee");
    }
    expect(programsBuilder.in).toHaveBeenCalledWith("id", ["program-1"]);
  });

  it("returns an empty list rather than querying programs at all when there are no assigned batches", async () => {
    const trainersBuilder = makeBuilder({ data: { id: "trainer-1" }, error: null });
    const batchTrainersBuilder = makeBuilder({ data: [], error: null });
    const programsBuilder = makeBuilder({ data: [], error: null });
    mockSupabase({
      fromTable: {
        trainers: trainersBuilder,
        batch_trainers: batchTrainersBuilder,
        programs: programsBuilder,
      },
    });

    const result = await getMyPrograms();
    expect(result).toEqual({ ok: true, data: [] });
    expect(programsBuilder.in).not.toHaveBeenCalled();
  });
});

function rpcStudentRow(overrides: Record<string, unknown> = {}) {
  return {
    student_id: "student-1",
    student_code: "STU-000001",
    first_name: "Priya",
    last_name: "Nair",
    phone: "+919999999999",
    email: "priya@example.com",
    batch_id: "batch-1",
    ...overrides,
  };
}

describe("getMyStudents", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads exclusively from the trainer_visible_students() RPC, never the base students table", async () => {
    const client = mockSupabase({
      fromTable: {},
      rpc: { data: [rpcStudentRow()], error: null },
    });

    const result = await getMyStudents();

    expect(result).toEqual({
      ok: true,
      data: [
        {
          studentId: "student-1",
          studentCode: "STU-000001",
          firstName: "Priya",
          lastName: "Nair",
          phone: "+919999999999",
          email: "priya@example.com",
          batchId: "batch-1",
        },
      ],
    });
    expect(client.rpc).toHaveBeenCalledWith("trainer_visible_students");
    expect(client.from).not.toHaveBeenCalled();
  });
});

describe("getMyStudentsForBatch", () => {
  beforeEach(() => vi.clearAllMocks());

  it("filters the trainer-scoped result set down to one batch", async () => {
    mockSupabase({
      fromTable: {},
      rpc: {
        data: [
          rpcStudentRow({ batch_id: "batch-1" }),
          rpcStudentRow({ batch_id: "batch-2" }),
        ],
        error: null,
      },
    });

    const result = await getMyStudentsForBatch("batch-1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveLength(1);
      expect(result.data[0].batchId).toBe("batch-1");
    }
  });
});

describe("getMyStudent", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the same not-found error for a nonexistent id and for a Student outside the caller's assignments", async () => {
    mockSupabase({ fromTable: {}, rpc: { data: [rpcStudentRow()], error: null } });

    const result = await getMyStudent("someone-elses-student-id");
    expect(result).toEqual({ ok: false, error: "Student not found." });
  });

  it("returns the matching student when they are within the caller's own scope", async () => {
    mockSupabase({ fromTable: {}, rpc: { data: [rpcStudentRow()], error: null } });

    const result = await getMyStudent("student-1");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.studentId).toBe("student-1");
  });
});
