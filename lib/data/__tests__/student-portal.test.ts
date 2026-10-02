import { describe, expect, it, vi, beforeEach } from "vitest";

// See lib/data/__tests__/trainers.test.ts for why `server-only` itself must
// be mocked to import the real data-layer module under Vitest.
vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

// getEnrollmentFinancialSummary has its own dedicated unit tests
// (lib/data/__tests__/enrollments.test.ts) — mocked here so these tests
// only exercise this module's own ownership-scoping and projection logic,
// not payments/refunds arithmetic.
vi.mock("@/lib/data/enrollments", () => ({
  getEnrollmentFinancialSummary: vi.fn(),
}));

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getEnrollmentFinancialSummary } from "@/lib/data/enrollments";
import {
  getMyStudentProfile,
  updateMyStudentProfile,
  getMyEnrollments,
  getMyEnrollment,
  getMyUpcomingClassSessions,
  getMyAttendanceSummary,
  getMyAttendanceForEnrollment,
} from "@/lib/data/student-portal";
import type { StudentSelfProfileInput } from "@/lib/validation/student-self-profile";

const AUTH_USER = { id: "auth-user-1" };

// A thenable fluent builder: select/eq/update all return itself so any
// combination of filters resolves the same way whether the caller awaits
// directly (as the payments/refunds-style bare `.eq()` terminal would) or
// calls `.maybeSingle()`/`.order()` explicitly — same pattern as
// lib/data/__tests__/enrollments.test.ts's makeListQueryBuilder, extended
// with a `.then` so a bare `.eq()` is itself awaitable.
function makeBuilder(resolvedValue: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {};
  builder.select = vi.fn(() => builder);
  builder.update = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.order = vi.fn(() => Promise.resolve(resolvedValue));
  builder.maybeSingle = vi.fn().mockResolvedValue(resolvedValue);
  builder.then = (onFulfilled: (value: { data: unknown; error: unknown }) => unknown) =>
    Promise.resolve(resolvedValue).then(onFulfilled);
  return builder;
}

function mockSupabase({
  authUser = AUTH_USER as { id: string } | null,
  fromTable,
}: {
  authUser?: { id: string } | null;
  fromTable: Record<string, unknown>;
}) {
  const client = {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: authUser } }) },
    from: vi.fn((table: string) => fromTable[table]),
  };
  vi.mocked(createSupabaseServerClient).mockResolvedValue(
    client as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
  );
  return client;
}

function baseSelfProfileInput(
  overrides: Partial<StudentSelfProfileInput> = {},
): StudentSelfProfileInput {
  return {
    phoneCountry: "IN",
    phone: "+919876543210",
    alternatePhone: null,
    addressLine1: null,
    addressLine2: null,
    city: null,
    state: null,
    postalCode: null,
    ...overrides,
  };
}

describe("getMyStudentProfile", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns not-signed-in when there is no authenticated user", async () => {
    mockSupabase({ authUser: null, fromTable: {} });
    const result = await getMyStudentProfile();
    expect(result).toEqual({ ok: false, error: "Not signed in." });
  });

  it("scopes the query by the caller's own auth_user_id, never a supplied id", async () => {
    const studentsBuilder = makeBuilder({
      data: {
        id: "student-1",
        student_code: "STU-000001",
        first_name: "Asha",
        last_name: "Rao",
        preferred_name: null,
        email: "asha@example.com",
        phone: "+919876543210",
        alternate_phone: null,
        address_line1: null,
        address_line2: null,
        city: null,
        state: null,
        postal_code: null,
        registration_date: "2026-01-01",
        status: "active",
      },
      error: null,
    });
    mockSupabase({ fromTable: { students: studentsBuilder } });

    const result = await getMyStudentProfile();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.id).toBe("student-1");
      expect(result.data.studentCode).toBe("STU-000001");
    }
    expect(studentsBuilder.eq).toHaveBeenCalledWith("auth_user_id", AUTH_USER.id);
  });

  it("propagates a not-found error rather than exposing another row", async () => {
    const studentsBuilder = makeBuilder({ data: null, error: null });
    mockSupabase({ fromTable: { students: studentsBuilder } });

    const result = await getMyStudentProfile();
    expect(result).toEqual({ ok: false, error: "Student profile not found." });
  });
});

describe("updateMyStudentProfile", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns not-signed-in when there is no authenticated user", async () => {
    mockSupabase({ authUser: null, fromTable: {} });
    const result = await updateMyStudentProfile(baseSelfProfileInput());
    expect(result).toEqual({ ok: false, error: "Not signed in." });
  });

  it("updates only phone/alternate phone/address columns, scoped to the caller's own row", async () => {
    const studentsBuilder = makeBuilder({ data: null, error: null });
    mockSupabase({ fromTable: { students: studentsBuilder } });

    const result = await updateMyStudentProfile(
      baseSelfProfileInput({ addressLine1: "221B Baker Street", city: "Mumbai" }),
    );

    expect(result).toEqual({ ok: true, data: null });
    expect(studentsBuilder.update).toHaveBeenCalledWith({
      phone: "+919876543210",
      alternate_phone: null,
      address_line1: "221B Baker Street",
      address_line2: null,
      city: "Mumbai",
      state: null,
      postal_code: null,
    });
    expect(studentsBuilder.eq).toHaveBeenCalledWith("auth_user_id", AUTH_USER.id);
  });

  it("surfaces a database error as a safe, generic failure", async () => {
    const studentsBuilder = makeBuilder({
      data: null,
      error: { message: "constraint violated" },
    });
    mockSupabase({ fromTable: { students: studentsBuilder } });

    const result = await updateMyStudentProfile(baseSelfProfileInput());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("Could not save changes. Please try again.");
    }
  });
});

function enrollmentJoinRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "enr-1",
    enrollment_code: "ENR-000001",
    status: "enrolled",
    enrollment_date: "2026-01-01",
    total_payable: "10000.00",
    program: { name: "Data Analytics", program_code: "DA" },
    batch: { name: "Batch A" },
    ...overrides,
  };
}

describe("getMyEnrollments", () => {
  beforeEach(() => vi.clearAllMocks());

  it("scopes the enrollment list to the caller's own resolved student id", async () => {
    const studentsBuilder = makeBuilder({ data: { id: "student-1" }, error: null });
    const enrollmentsBuilder = makeBuilder({ data: [enrollmentJoinRow()], error: null });
    mockSupabase({
      fromTable: { students: studentsBuilder, enrollments: enrollmentsBuilder },
    });
    vi.mocked(getEnrollmentFinancialSummary).mockResolvedValue({
      ok: true,
      data: {
        totalPayablePaise: 1_000_000,
        totalPaidPaise: 0,
        totalRefundedPaise: 0,
        outstandingPaise: 1_000_000,
      },
    });

    const result = await getMyEnrollments();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual([
        {
          id: "enr-1",
          enrollmentCode: "ENR-000001",
          programName: "Data Analytics",
          programCode: "DA",
          batchName: "Batch A",
          status: "enrolled",
          enrollmentDate: "2026-01-01",
          totalPayablePaise: 1_000_000,
          outstandingPaise: 1_000_000,
        },
      ]);
    }
    expect(enrollmentsBuilder.eq).toHaveBeenCalledWith("student_id", "student-1");
    // Never exposes discount reason, source, notes, or the fee breakdown —
    // the returned row has exactly the safe Phase 10 projection above.
  });

  it("never leaks another student's enrollment via a resolution failure", async () => {
    const studentsBuilder = makeBuilder({ data: null, error: null });
    mockSupabase({ fromTable: { students: studentsBuilder } });

    const result = await getMyEnrollments();
    expect(result).toEqual({ ok: false, error: "Student profile not found." });
  });
});

describe("getMyEnrollment", () => {
  beforeEach(() => vi.clearAllMocks());

  it("filters by both the requested id AND the caller's own student id", async () => {
    const studentsBuilder = makeBuilder({ data: { id: "student-1" }, error: null });
    const enrollmentsBuilder = makeBuilder({ data: enrollmentJoinRow(), error: null });
    mockSupabase({
      fromTable: { students: studentsBuilder, enrollments: enrollmentsBuilder },
    });
    vi.mocked(getEnrollmentFinancialSummary).mockResolvedValue({
      ok: true,
      data: {
        totalPayablePaise: 1_000_000,
        totalPaidPaise: 0,
        totalRefundedPaise: 0,
        outstandingPaise: 1_000_000,
      },
    });

    const result = await getMyEnrollment("enr-1");

    expect(result.ok).toBe(true);
    expect(enrollmentsBuilder.eq).toHaveBeenCalledWith("id", "enr-1");
    expect(enrollmentsBuilder.eq).toHaveBeenCalledWith("student_id", "student-1");
  });

  it("returns the same not-found error for a nonexistent id and for another student's own enrollment — never a distinct response that would confirm the id exists", async () => {
    const studentsBuilder = makeBuilder({ data: { id: "student-1" }, error: null });
    const enrollmentsBuilder = makeBuilder({ data: null, error: null });
    mockSupabase({
      fromTable: { students: studentsBuilder, enrollments: enrollmentsBuilder },
    });

    const result = await getMyEnrollment("someone-elses-enrollment-id");
    expect(result).toEqual({ ok: false, error: "Enrollment not found." });
  });
});

describe("getMyUpcomingClassSessions", () => {
  beforeEach(() => vi.clearAllMocks());

  // A dedicated local builder (not the shared makeBuilder above, whose
  // .order() resolves immediately rather than chaining to .limit()) — this
  // query is select -> eq -> gte -> order -> limit, each step returning the
  // same thenable object, same style as
  // lib/data/__tests__/trainer-portal.test.ts's own builder.
  function sessionsBuilder(resolvedValue: { data: unknown; error: unknown }) {
    const builder: Record<string, unknown> = {};
    builder.select = vi.fn(() => builder);
    builder.eq = vi.fn(() => builder);
    builder.gte = vi.fn(() => builder);
    builder.order = vi.fn(() => builder);
    builder.limit = vi.fn(() => builder);
    builder.then = (onFulfilled: (value: { data: unknown; error: unknown }) => unknown) =>
      Promise.resolve(resolvedValue).then(onFulfilled);
    return builder;
  }

  it("reads scheduled, upcoming sessions scoped by RLS, with no student_id/batch_id filter in the query itself", async () => {
    const classSessionsBuilder = sessionsBuilder({
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

  it("returns an empty list rather than an error when there are no upcoming sessions", async () => {
    const classSessionsBuilder = sessionsBuilder({ data: [], error: null });
    mockSupabase({ fromTable: { class_sessions: classSessionsBuilder } });

    const result = await getMyUpcomingClassSessions(5);
    expect(result).toEqual({ ok: true, data: [] });
  });
});

describe("getMyAttendanceSummary", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads student_attendance_summary with no extra filter — RLS (attendance_select_own) does the scoping", async () => {
    const summaryBuilder = makeBuilder({
      data: [
        {
          enrollment_id: "enr-1",
          total_sessions: 10,
          present_count: 8,
          absent_count: 1,
          late_count: 1,
          excused_count: 0,
          attendance_percentage: 90,
        },
      ],
      error: null,
    });
    mockSupabase({ fromTable: { student_attendance_summary: summaryBuilder } });

    const result = await getMyAttendanceSummary();

    expect(result).toEqual({
      ok: true,
      data: [
        {
          enrollmentId: "enr-1",
          totalSessions: 10,
          presentCount: 8,
          absentCount: 1,
          lateCount: 1,
          excusedCount: 0,
          attendancePercentage: 90,
        },
      ],
    });
  });
});

describe("getMyAttendanceForEnrollment", () => {
  beforeEach(() => vi.clearAllMocks());

  it("re-verifies ownership via getMyEnrollment before reading any attendance row", async () => {
    const studentsBuilder = makeBuilder({ data: { id: "student-1" }, error: null });
    const enrollmentsBuilder = makeBuilder({ data: null, error: null });
    mockSupabase({
      fromTable: { students: studentsBuilder, enrollments: enrollmentsBuilder },
    });

    const result = await getMyAttendanceForEnrollment("someone-elses-enrollment-id");
    expect(result).toEqual({ ok: false, error: "Enrollment not found." });
  });

  it("returns the summary and per-session records, with no notes/marked_by fields exposed", async () => {
    const studentsBuilder = makeBuilder({ data: { id: "student-1" }, error: null });
    const enrollmentsBuilder = makeBuilder({ data: enrollmentJoinRow(), error: null });
    const summaryBuilder = makeBuilder({
      data: {
        enrollment_id: "enr-1",
        total_sessions: 2,
        present_count: 1,
        absent_count: 1,
        late_count: 0,
        excused_count: 0,
        attendance_percentage: 50,
      },
      error: null,
    });
    const attendanceBuilder = makeBuilder({
      data: [
        {
          id: "att-1",
          status: "present",
          class_session: { session_date: "2026-09-02", topic: "Intro" },
        },
        {
          id: "att-2",
          status: "absent",
          class_session: { session_date: "2026-09-01", topic: null },
        },
      ],
      error: null,
    });
    mockSupabase({
      fromTable: {
        students: studentsBuilder,
        enrollments: enrollmentsBuilder,
        student_attendance_summary: summaryBuilder,
        attendance: attendanceBuilder,
      },
    });
    vi.mocked(getEnrollmentFinancialSummary).mockResolvedValue({
      ok: true,
      data: {
        totalPayablePaise: 1_000_000,
        totalPaidPaise: 0,
        totalRefundedPaise: 0,
        outstandingPaise: 1_000_000,
      },
    });

    const result = await getMyAttendanceForEnrollment("enr-1");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.summary).toEqual({
      enrollmentId: "enr-1",
      totalSessions: 2,
      presentCount: 1,
      absentCount: 1,
      lateCount: 0,
      excusedCount: 0,
      attendancePercentage: 50,
    });
    // Sorted by session date descending; no `notes`/`marked_by` keys at all.
    expect(result.data.records).toEqual([
      { id: "att-1", sessionDate: "2026-09-02", topic: "Intro", status: "present" },
      { id: "att-2", sessionDate: "2026-09-01", topic: null, status: "absent" },
    ]);
    for (const record of result.data.records) {
      expect(record).not.toHaveProperty("notes");
      expect(record).not.toHaveProperty("markedBy");
    }
  });
});
