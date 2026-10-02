import { describe, expect, it, vi, beforeEach } from "vitest";

// See lib/data/__tests__/trainers.test.ts for why `server-only` itself must
// be mocked to import the real data-layer module under Vitest.
vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn(),
}));

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  getMyTrainerProfile,
  getMyBatches,
  getMyBatch,
  getMyPrograms,
  getMyStudents,
  getMyStudentsForBatch,
  getMyStudent,
  getMySessionsForBatch,
  getMySession,
  createMyClassSession,
  updateMyClassSession,
  updateMyClassSessionStatus,
  getMyUpcomingClassSessions,
  getMyEligibleRosterForSession,
  markMyAttendanceForSession,
} from "@/lib/data/trainer-portal";
import type { ClassSessionInput } from "@/lib/validation/class-sessions";

const AUTH_USER = { id: "auth-user-1" };

// Same thenable fluent builder as lib/data/__tests__/student-portal.test.ts
// (Phase 10) — select/eq/in/order/gte/insert/update all return itself so any
// combination of filters resolves the same way whether the caller awaits
// directly or calls `.maybeSingle()`/`.single()` explicitly.
function makeBuilder(resolvedValue: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {};
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.in = vi.fn(() => builder);
  builder.order = vi.fn(() => builder);
  builder.gte = vi.fn(() => builder);
  builder.limit = vi.fn(() => builder);
  builder.insert = vi.fn(() => builder);
  builder.update = vi.fn(() => builder);
  builder.maybeSingle = vi.fn().mockResolvedValue(resolvedValue);
  builder.single = vi.fn().mockResolvedValue(resolvedValue);
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

function classSessionJoinRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "session-1",
    batch_id: "batch-1",
    trainer_id: null,
    session_date: "2026-09-01",
    start_time: "09:00:00",
    end_time: "11:00:00",
    topic: "Introduction",
    description: null,
    meeting_link: null,
    status: "scheduled",
    notes: null,
    trainer: null,
    ...overrides,
  };
}

function baseSessionInput(): ClassSessionInput {
  return {
    sessionDate: "2026-09-01",
    startTime: "09:00",
    endTime: "11:00",
    topic: "Introduction",
    description: null,
    meetingLink: null,
    notes: null,
  };
}

describe("getMySessionsForBatch", () => {
  beforeEach(() => vi.clearAllMocks());

  it("verifies batch ownership via getMyBatch before listing that batch's sessions", async () => {
    const trainersBuilder = makeBuilder({ data: { id: "trainer-1" }, error: null });
    const batchTrainersBuilder = makeBuilder({ data: batchJoinRow(), error: null });
    const classSessionsBuilder = makeBuilder({
      data: [classSessionJoinRow()],
      error: null,
    });
    mockSupabase({
      fromTable: {
        trainers: trainersBuilder,
        batch_trainers: batchTrainersBuilder,
        class_sessions: classSessionsBuilder,
      },
    });

    const result = await getMySessionsForBatch("batch-1");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe("session-1");
    }
    expect(classSessionsBuilder.eq).toHaveBeenCalledWith("batch_id", "batch-1");
  });

  it("returns the batch's own not-found error for an unassigned batch, never querying sessions", async () => {
    const trainersBuilder = makeBuilder({ data: { id: "trainer-1" }, error: null });
    const batchTrainersBuilder = makeBuilder({ data: null, error: null });
    const classSessionsBuilder = makeBuilder({ data: [], error: null });
    mockSupabase({
      fromTable: {
        trainers: trainersBuilder,
        batch_trainers: batchTrainersBuilder,
        class_sessions: classSessionsBuilder,
      },
    });

    const result = await getMySessionsForBatch("unassigned-batch");
    expect(result).toEqual({ ok: false, error: "Batch not found." });
    expect(classSessionsBuilder.select).not.toHaveBeenCalled();
  });
});

describe("getMySession", () => {
  beforeEach(() => vi.clearAllMocks());

  it("filters by both the session id and the batch id, after confirming batch ownership", async () => {
    const trainersBuilder = makeBuilder({ data: { id: "trainer-1" }, error: null });
    const batchTrainersBuilder = makeBuilder({ data: batchJoinRow(), error: null });
    const classSessionsBuilder = makeBuilder({
      data: classSessionJoinRow(),
      error: null,
    });
    mockSupabase({
      fromTable: {
        trainers: trainersBuilder,
        batch_trainers: batchTrainersBuilder,
        class_sessions: classSessionsBuilder,
      },
    });

    const result = await getMySession("batch-1", "session-1");

    expect(result.ok).toBe(true);
    expect(classSessionsBuilder.eq).toHaveBeenCalledWith("id", "session-1");
    expect(classSessionsBuilder.eq).toHaveBeenCalledWith("batch_id", "batch-1");
  });

  it("returns the same not-found error for a nonexistent session and for one on a different batch", async () => {
    const trainersBuilder = makeBuilder({ data: { id: "trainer-1" }, error: null });
    const batchTrainersBuilder = makeBuilder({ data: batchJoinRow(), error: null });
    const classSessionsBuilder = makeBuilder({ data: null, error: null });
    mockSupabase({
      fromTable: {
        trainers: trainersBuilder,
        batch_trainers: batchTrainersBuilder,
        class_sessions: classSessionsBuilder,
      },
    });

    const result = await getMySession("batch-1", "someone-elses-session");
    expect(result).toEqual({ ok: false, error: "Class session not found." });
  });
});

describe("createMyClassSession", () => {
  beforeEach(() => vi.clearAllMocks());

  it("verifies batch ownership and always sets trainer_id to the caller's own resolved id", async () => {
    const trainersBuilder = makeBuilder({ data: { id: "trainer-1" }, error: null });
    const batchTrainersBuilder = makeBuilder({ data: batchJoinRow(), error: null });
    const classSessionsBuilder = makeBuilder({ data: { id: "session-1" }, error: null });
    mockSupabase({
      fromTable: {
        trainers: trainersBuilder,
        batch_trainers: batchTrainersBuilder,
        class_sessions: classSessionsBuilder,
      },
    });

    const result = await createMyClassSession("batch-1", baseSessionInput());

    expect(result).toEqual({ ok: true, data: { id: "session-1" } });
    expect(classSessionsBuilder.insert).toHaveBeenCalledWith(
      expect.objectContaining({ batch_id: "batch-1", trainer_id: "trainer-1" }),
    );
  });

  it("refuses to create a session for a batch the caller is not assigned to", async () => {
    const trainersBuilder = makeBuilder({ data: { id: "trainer-1" }, error: null });
    const batchTrainersBuilder = makeBuilder({ data: null, error: null });
    const classSessionsBuilder = makeBuilder({ data: { id: "session-1" }, error: null });
    mockSupabase({
      fromTable: {
        trainers: trainersBuilder,
        batch_trainers: batchTrainersBuilder,
        class_sessions: classSessionsBuilder,
      },
    });

    const result = await createMyClassSession("unassigned-batch", baseSessionInput());
    expect(result).toEqual({ ok: false, error: "Batch not found." });
    expect(classSessionsBuilder.insert).not.toHaveBeenCalled();
  });
});

describe("updateMyClassSession", () => {
  beforeEach(() => vi.clearAllMocks());

  it("verifies the session belongs to the caller's own assigned batch before updating", async () => {
    const trainersBuilder = makeBuilder({ data: { id: "trainer-1" }, error: null });
    const batchTrainersBuilder = makeBuilder({ data: batchJoinRow(), error: null });
    const classSessionsBuilder = makeBuilder({
      data: classSessionJoinRow(),
      error: null,
    });
    mockSupabase({
      fromTable: {
        trainers: trainersBuilder,
        batch_trainers: batchTrainersBuilder,
        class_sessions: classSessionsBuilder,
      },
    });

    const result = await updateMyClassSession("batch-1", "session-1", baseSessionInput());

    expect(result).toEqual({ ok: true, data: null });
    const updateMock = classSessionsBuilder.update as ReturnType<typeof vi.fn>;
    const updatePayload = updateMock.mock.calls[0][0];
    expect(updatePayload).not.toHaveProperty("batch_id");
    expect(updatePayload).not.toHaveProperty("trainer_id");
  });

  it("refuses to update a session on an unrelated batch", async () => {
    const trainersBuilder = makeBuilder({ data: { id: "trainer-1" }, error: null });
    const batchTrainersBuilder = makeBuilder({ data: null, error: null });
    const classSessionsBuilder = makeBuilder({ data: null, error: null });
    mockSupabase({
      fromTable: {
        trainers: trainersBuilder,
        batch_trainers: batchTrainersBuilder,
        class_sessions: classSessionsBuilder,
      },
    });

    const result = await updateMyClassSession(
      "unassigned-batch",
      "session-1",
      baseSessionInput(),
    );
    expect(result).toEqual({ ok: false, error: "Batch not found." });
    expect(classSessionsBuilder.update).not.toHaveBeenCalled();
  });
});

describe("updateMyClassSessionStatus", () => {
  beforeEach(() => vi.clearAllMocks());

  it("verifies ownership before changing the status", async () => {
    const trainersBuilder = makeBuilder({ data: { id: "trainer-1" }, error: null });
    const batchTrainersBuilder = makeBuilder({ data: batchJoinRow(), error: null });
    const classSessionsBuilder = makeBuilder({
      data: classSessionJoinRow(),
      error: null,
    });
    mockSupabase({
      fromTable: {
        trainers: trainersBuilder,
        batch_trainers: batchTrainersBuilder,
        class_sessions: classSessionsBuilder,
      },
    });

    const result = await updateMyClassSessionStatus("batch-1", "session-1", "completed");

    expect(result).toEqual({ ok: true, data: null });
    expect(classSessionsBuilder.update).toHaveBeenCalledWith({ status: "completed" });
  });
});

describe("getMyUpcomingClassSessions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads scheduled, upcoming sessions scoped by RLS, never a base/batch filter in the query itself", async () => {
    const classSessionsBuilder = makeBuilder({
      data: [
        {
          id: "session-1",
          session_date: "2099-01-01",
          start_time: "09:00:00",
          end_time: "11:00:00",
          batch: { name: "Batch A", program: { name: "Data Analytics" } },
        },
      ],
      error: null,
    });
    mockSupabase({ fromTable: { class_sessions: classSessionsBuilder } });

    const result = await getMyUpcomingClassSessions(5);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual([
        {
          id: "session-1",
          batchName: "Batch A",
          programName: "Data Analytics",
          sessionDate: "2099-01-01",
          startTime: "09:00:00",
          endTime: "11:00:00",
        },
      ]);
    }
    expect(classSessionsBuilder.eq).toHaveBeenCalledWith("status", "scheduled");
    expect(classSessionsBuilder.limit).toHaveBeenCalledWith(5);
  });
});

describe("getMyEligibleRosterForSession", () => {
  beforeEach(() => vi.clearAllMocks());

  it("merges trainer_visible_enrollments/students with existing attendance marks for this batch only", async () => {
    const trainersBuilder = makeBuilder({ data: { id: "trainer-1" }, error: null });
    const batchTrainersBuilder = makeBuilder({ data: batchJoinRow(), error: null });
    const classSessionsBuilder = makeBuilder({
      data: classSessionJoinRow(),
      error: null,
    });
    const attendanceBuilder = makeBuilder({
      data: [
        {
          id: "att-1",
          enrollment_id: "enr-1",
          status: "present",
          notes: null,
          marked_at: "t",
        },
      ],
      error: null,
    });

    const client = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: AUTH_USER } }) },
      from: vi.fn(
        (table: string) =>
          ({
            trainers: trainersBuilder,
            batch_trainers: batchTrainersBuilder,
            class_sessions: classSessionsBuilder,
            attendance: attendanceBuilder,
          })[table],
      ),
      rpc: vi.fn((name: string) => {
        if (name === "trainer_visible_enrollments") {
          return Promise.resolve({
            data: [
              { enrollment_id: "enr-1", student_id: "stu-1", batch_id: "batch-1" },
              // A different batch's enrollment the RPC also returns (the
              // Trainer may be assigned to more than one batch) — must be
              // filtered out, not shown in this session's roster.
              { enrollment_id: "enr-2", student_id: "stu-2", batch_id: "other-batch" },
            ],
            error: null,
          });
        }
        if (name === "trainer_visible_students") {
          return Promise.resolve({
            data: [
              {
                student_id: "stu-1",
                student_code: "S-1",
                first_name: "Amy",
                last_name: "Z",
                batch_id: "batch-1",
              },
              {
                student_id: "stu-2",
                student_code: "S-2",
                first_name: "Cal",
                last_name: "Q",
                batch_id: "other-batch",
              },
            ],
            error: null,
          });
        }
        throw new Error(`Unexpected rpc: ${name}`);
      }),
    };
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    const result = await getMyEligibleRosterForSession("batch-1", "session-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual([
      {
        enrollmentId: "enr-1",
        studentId: "stu-1",
        studentCode: "S-1",
        firstName: "Amy",
        lastName: "Z",
        attendanceId: "att-1",
        status: "present",
        notes: null,
        markedAt: "t",
      },
    ]);
  });
});

describe("markMyAttendanceForSession", () => {
  beforeEach(() => vi.clearAllMocks());

  it("marks a fresh entry under the caller's own trainer id, writing no attendance_audit row", async () => {
    const trainersBuilder = makeBuilder({ data: { id: "trainer-1" }, error: null });
    const batchTrainersBuilder = makeBuilder({ data: batchJoinRow(), error: null });
    const classSessionsBuilder = makeBuilder({
      data: classSessionJoinRow(),
      error: null,
    });
    const attendanceInsert = vi.fn().mockResolvedValue({ error: null });
    const attendanceExistingBuilder = makeBuilder({ data: [], error: null });

    const client = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: AUTH_USER } }) },
      from: vi.fn((table: string) => {
        if (table === "trainers") return trainersBuilder;
        if (table === "batch_trainers") return batchTrainersBuilder;
        if (table === "class_sessions") return classSessionsBuilder;
        if (table === "attendance") {
          // First call: the existing-rows read. Second call: the insert.
          const calls = client.from.mock.calls.filter(
            (c) => c[0] === "attendance",
          ).length;
          return calls <= 1 ? attendanceExistingBuilder : { insert: attendanceInsert };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
      rpc: vi.fn().mockResolvedValue({
        data: [{ enrollment_id: "enr-1", student_id: "stu-1", batch_id: "batch-1" }],
        error: null,
      }),
    };
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    const result = await markMyAttendanceForSession("batch-1", "session-1", [
      { enrollmentId: "enr-1", status: "present", notes: null },
    ]);

    expect(result).toEqual({ ok: true, data: { marked: 1, corrected: 0, ignored: 0 } });
    expect(attendanceInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        enrollment_id: "enr-1",
        student_id: "stu-1",
        marked_by: "trainer-1",
        marked_by_type: "trainer",
      }),
    );
    expect(createSupabaseAdminClient).not.toHaveBeenCalled();
  });

  it("uses the service-role client only for the attendance_audit insert on a status correction", async () => {
    const trainersBuilder = makeBuilder({ data: { id: "trainer-1" }, error: null });
    const batchTrainersBuilder = makeBuilder({ data: batchJoinRow(), error: null });
    const classSessionsBuilder = makeBuilder({
      data: classSessionJoinRow(),
      error: null,
    });
    const attendanceExistingBuilder = makeBuilder({
      data: [{ id: "att-1", enrollment_id: "enr-1", status: "absent", notes: null }],
      error: null,
    });
    const beforeRowBuilder = makeBuilder({
      data: { id: "att-1", status: "absent", notes: null },
      error: null,
    });
    const updateEq = vi.fn().mockResolvedValue({ error: null });

    const client = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: AUTH_USER } }) },
      from: vi.fn((table: string) => {
        if (table === "trainers") return trainersBuilder;
        if (table === "batch_trainers") return batchTrainersBuilder;
        if (table === "class_sessions") return classSessionsBuilder;
        if (table === "attendance") {
          const calls = client.from.mock.calls.filter(
            (c) => c[0] === "attendance",
          ).length;
          if (calls <= 1) return attendanceExistingBuilder;
          if (calls === 2) return beforeRowBuilder;
          return { update: () => ({ eq: updateEq }) };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
      rpc: vi.fn().mockResolvedValue({
        data: [{ enrollment_id: "enr-1", student_id: "stu-1", batch_id: "batch-1" }],
        error: null,
      }),
    };
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    const auditInsert = vi.fn().mockResolvedValue({ error: null });
    vi.mocked(createSupabaseAdminClient).mockReturnValue({
      from: vi.fn(() => ({ insert: auditInsert })),
    } as never);

    const result = await markMyAttendanceForSession("batch-1", "session-1", [
      { enrollmentId: "enr-1", status: "present", notes: null },
    ]);

    expect(result).toEqual({ ok: true, data: { marked: 0, corrected: 1, ignored: 0 } });
    expect(createSupabaseAdminClient).toHaveBeenCalledTimes(1);
    expect(auditInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        attendance_id: "att-1",
        changed_by: "trainer-1",
        changed_by_type: "trainer",
        previous_status: "absent",
        new_status: "present",
      }),
    );
  });
});
