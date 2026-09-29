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
