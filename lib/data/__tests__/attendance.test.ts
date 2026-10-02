import { describe, expect, it, vi, beforeEach } from "vitest";

// See lib/data/__tests__/trainers.test.ts for why `server-only` itself must
// be mocked to import the real data-layer module under Vitest.
vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/lib/data/class-sessions", () => ({
  getClassSession: vi.fn(),
}));

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getClassSession, type ClassSessionRow } from "@/lib/data/class-sessions";
import {
  getEligibleRosterForClassSession,
  markAttendanceForClassSession,
} from "@/lib/data/attendance";

function okSession(overrides: Partial<ClassSessionRow> = {}): {
  ok: true;
  data: ClassSessionRow;
} {
  return {
    ok: true,
    data: {
      id: "session-1",
      batchId: "batch-1",
      trainerId: null,
      trainerName: null,
      sessionDate: "2026-09-01",
      startTime: null,
      endTime: null,
      topic: "Intro",
      description: null,
      meetingLink: null,
      status: "scheduled",
      notes: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      ...overrides,
    },
  };
}

/**
 * Dispatches `.from(table)` calls to a queue of pre-built chain mocks per
 * table — each call to the same table consumes the next queued chain, in
 * call order. This mirrors the actual sequence lib/data/attendance.ts's
 * functions issue (a roster read, then one insert/select/update/audit-insert
 * sequence per submitted row) without needing a real Postgres connection.
 */
function createFromMock(queues: Record<string, Array<unknown>>) {
  const cursors: Record<string, number> = {};
  return vi.fn((table: string) => {
    const queue = queues[table] ?? [];
    const i = cursors[table] ?? 0;
    cursors[table] = i + 1;
    if (i >= queue.length) {
      throw new Error(`No mock queued for from("${table}") call #${i + 1}`);
    }
    return queue[i];
  });
}

beforeEach(() => vi.clearAllMocks());

describe("getEligibleRosterForClassSession", () => {
  it("propagates a not-found session without querying anything else", async () => {
    vi.mocked(getClassSession).mockResolvedValue({
      ok: false,
      error: "Class session not found.",
    });

    const result = await getEligibleRosterForClassSession("batch-1", "missing-session");
    expect(result).toEqual({ ok: false, error: "Class session not found." });
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
  });

  it("merges the batch's enrollments with any existing attendance marks", async () => {
    vi.mocked(getClassSession).mockResolvedValue(okSession());

    const enrollmentsEq = vi.fn().mockResolvedValue({
      data: [
        {
          id: "enr-1",
          status: "enrolled",
          student: {
            id: "stu-1",
            student_code: "S-1",
            first_name: "Amy",
            last_name: "Z",
          },
        },
        {
          id: "enr-2",
          status: "enrolled",
          student: {
            id: "stu-2",
            student_code: "S-2",
            first_name: "Bob",
            last_name: "A",
          },
        },
      ],
      error: null,
    });
    const attendanceEq = vi.fn().mockResolvedValue({
      data: [
        {
          id: "att-1",
          enrollment_id: "enr-1",
          status: "present",
          notes: null,
          marked_at: "2026-09-01T09:00:00.000Z",
        },
      ],
      error: null,
    });

    const from = createFromMock({
      enrollments: [{ select: () => ({ eq: enrollmentsEq }) }],
      attendance: [{ select: () => ({ eq: attendanceEq }) }],
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from } as never);

    const result = await getEligibleRosterForClassSession("batch-1", "session-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Sorted by name: Bob Á comes before Amy Z alphabetically? "Amy" < "Bob",
    // so Amy is first.
    expect(result.data.roster).toEqual([
      {
        enrollmentId: "enr-1",
        studentId: "stu-1",
        studentCode: "S-1",
        firstName: "Amy",
        lastName: "Z",
        enrollmentStatus: "enrolled",
        attendanceId: "att-1",
        status: "present",
        notes: null,
        markedAt: "2026-09-01T09:00:00.000Z",
      },
      {
        enrollmentId: "enr-2",
        studentId: "stu-2",
        studentCode: "S-2",
        firstName: "Bob",
        lastName: "A",
        enrollmentStatus: "enrolled",
        attendanceId: null,
        status: null,
        notes: null,
        markedAt: null,
      },
    ]);
  });
});

describe("markAttendanceForClassSession", () => {
  const actor = { id: "admin-1", type: "admin" as const };

  it("ignores a submitted enrollmentId that does not belong to this session's batch", async () => {
    vi.mocked(getClassSession).mockResolvedValue(okSession());

    // Only "enr-eligible" actually resolves from the eligibility query, even
    // though the caller also submitted "enr-foreign".
    const eligibleEq = vi.fn().mockReturnValue({
      in: vi.fn().mockResolvedValue({
        data: [{ id: "enr-eligible", student_id: "stu-1" }],
        error: null,
      }),
    });
    const existingEq = vi.fn().mockResolvedValue({ data: [], error: null });
    const insert = vi.fn().mockResolvedValue({ error: null });

    const from = createFromMock({
      enrollments: [{ select: () => ({ eq: eligibleEq }) }],
      attendance: [{ select: () => ({ eq: existingEq }) }, { insert }],
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from } as never);

    const result = await markAttendanceForClassSession(
      "batch-1",
      "session-1",
      [
        { enrollmentId: "enr-eligible", status: "present", notes: null },
        { enrollmentId: "enr-foreign", status: "absent", notes: null },
      ],
      actor,
    );

    expect(result).toEqual({ ok: true, data: { marked: 1, corrected: 0, ignored: 1 } });
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ enrollment_id: "enr-eligible", student_id: "stu-1" }),
    );
  });

  it("writes no attendance_audit row for a fresh mark (only for corrections)", async () => {
    vi.mocked(getClassSession).mockResolvedValue(okSession());

    const eligibleEq = vi.fn().mockReturnValue({
      in: vi.fn().mockResolvedValue({
        data: [{ id: "enr-1", student_id: "stu-1" }],
        error: null,
      }),
    });
    const existingEq = vi.fn().mockResolvedValue({ data: [], error: null });
    const insert = vi.fn().mockResolvedValue({ error: null });
    const auditInsert = vi.fn();

    const from = createFromMock({
      enrollments: [{ select: () => ({ eq: eligibleEq }) }],
      attendance: [{ select: () => ({ eq: existingEq }) }, { insert }],
      attendance_audit: [{ insert: auditInsert }],
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from } as never);

    const result = await markAttendanceForClassSession(
      "batch-1",
      "session-1",
      [{ enrollmentId: "enr-1", status: "present", notes: null }],
      actor,
    );

    expect(result).toEqual({ ok: true, data: { marked: 1, corrected: 0, ignored: 0 } });
    expect(auditInsert).not.toHaveBeenCalled();
  });

  it("corrects an existing mark and writes an attendance_audit row when status changes", async () => {
    vi.mocked(getClassSession).mockResolvedValue(okSession());

    const eligibleEq = vi.fn().mockReturnValue({
      in: vi.fn().mockResolvedValue({
        data: [{ id: "enr-1", student_id: "stu-1" }],
        error: null,
      }),
    });
    const existingEq = vi.fn().mockResolvedValue({
      data: [{ id: "att-1", enrollment_id: "enr-1", status: "absent", notes: null }],
      error: null,
    });
    const beforeMaybeSingle = vi.fn().mockResolvedValue({
      data: { id: "att-1", status: "absent", notes: null },
      error: null,
    });
    const updateEq = vi.fn().mockResolvedValue({ error: null });
    const auditInsert = vi.fn().mockResolvedValue({ error: null });

    const from = createFromMock({
      enrollments: [{ select: () => ({ eq: eligibleEq }) }],
      attendance: [
        { select: () => ({ eq: existingEq }) },
        {
          select: () => ({
            eq: () => ({ eq: () => ({ maybeSingle: beforeMaybeSingle }) }),
          }),
        },
        { update: () => ({ eq: updateEq }) },
      ],
      attendance_audit: [{ insert: auditInsert }],
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from } as never);

    const result = await markAttendanceForClassSession(
      "batch-1",
      "session-1",
      [{ enrollmentId: "enr-1", status: "present", notes: null }],
      actor,
    );

    expect(result).toEqual({ ok: true, data: { marked: 0, corrected: 1, ignored: 0 } });
    expect(auditInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        attendance_id: "att-1",
        previous_status: "absent",
        new_status: "present",
      }),
    );
  });

  it("does nothing for a roster with no selected statuses", async () => {
    vi.mocked(getClassSession).mockResolvedValue(okSession());
    const result = await markAttendanceForClassSession(
      "batch-1",
      "session-1",
      [{ enrollmentId: "enr-1", status: undefined, notes: null }],
      actor,
    );
    expect(result).toEqual({ ok: true, data: { marked: 0, corrected: 0, ignored: 0 } });
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
  });
});
