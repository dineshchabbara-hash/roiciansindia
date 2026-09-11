import { describe, expect, it, vi, beforeEach } from "vitest";

// See lib/data/__tests__/trainers.test.ts for why `server-only` itself must
// be mocked to import the real data-layer module under Vitest.
vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  createProgramRecord,
  findProgramByExactCode,
  getProgramCodePattern,
  getProgramRelatedSummary,
  updateProgramProfile,
} from "@/lib/data/programs";
import type { ProgramProfileInput } from "@/lib/validation/programs";

function baseInput(): ProgramProfileInput {
  return {
    programCode: "FSD-101",
    name: "Full Stack Development",
    description: null,
    category: null,
    durationValue: 8,
    durationUnit: "weeks",
    deliveryMode: "online",
    regularFee: "50000",
    registrationFee: "0",
    taxRatePercent: null,
    certificateEligible: true,
    installmentsAllowed: true,
  };
}

describe("createProgramRecord", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("inserts the program and returns its id/code", async () => {
    const single = vi.fn().mockResolvedValue({
      data: { id: "program-1", program_code: "FSD-101" },
      error: null,
    });
    const select = vi.fn().mockReturnValue({ single });
    const insert = vi.fn().mockReturnValue({ select });
    const from = vi.fn().mockReturnValue({ insert });
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from } as never);

    const result = await createProgramRecord(baseInput());

    expect(result).toEqual({
      ok: true,
      data: { id: "program-1", programCode: "FSD-101" },
    });
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ program_code: "FSD-101", regular_fee: "50000" }),
    );
  });

  // Regression coverage for a real Phase 7 bug report: 50000.50/500.50 were
  // observed rounded after saving. Traced end to end — the root cause was
  // isolated to the *display* formatter (see lib/domain/__tests__/money.test.ts),
  // but this proves the other half: the insert payload sent to Postgres
  // carries the admin-entered decimal string completely unchanged, for
  // every value from the bug report, for both fee columns.
  it.each([
    ["50000.50", "0"],
    ["500.50", "0"],
    ["50000.99", "1000.50"],
    ["0.50", "0.50"],
    ["50000", "0"],
  ])(
    "inserts regular_fee=%s and registration_fee=%s as exact, unmodified decimal strings",
    async (regularFee, registrationFee) => {
      const single = vi.fn().mockResolvedValue({
        data: { id: "program-1", program_code: "FSD-101" },
        error: null,
      });
      const select = vi.fn().mockReturnValue({ single });
      const insert = vi.fn().mockReturnValue({ select });
      const from = vi.fn().mockReturnValue({ insert });
      vi.mocked(createSupabaseServerClient).mockResolvedValue({ from } as never);

      await createProgramRecord({ ...baseInput(), regularFee, registrationFee });

      const insertPayload = insert.mock.calls[0][0];
      expect(insertPayload.regular_fee).toBe(regularFee);
      expect(insertPayload.registration_fee).toBe(registrationFee);
      // Never a JS number — that would silently normalize e.g. "500.50" to
      // 500.5, and Postgres numeric would still store it correctly, but a
      // number type is exactly the sort of value a future refactor could
      // accidentally run through Math.round/parseInt.
      expect(typeof insertPayload.regular_fee).toBe("string");
      expect(typeof insertPayload.registration_fee).toBe("string");
    },
  );

  it("translates a Postgres unique_violation on program_code into a clear form error", async () => {
    const single = vi.fn().mockResolvedValue({
      data: null,
      error: {
        code: "23505",
        message:
          'duplicate key value violates unique constraint "programs_program_code_key"',
      },
    });
    const select = vi.fn().mockReturnValue({ single });
    const insert = vi.fn().mockReturnValue({ select });
    const from = vi.fn().mockReturnValue({ insert });
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from } as never);

    const result = await createProgramRecord(baseInput());

    expect(result).toEqual({
      ok: false,
      error: "This program code is already in use. Choose a different code.",
    });
  });

  it("surfaces an unrelated DB error as a generic message, not the raw Postgres error", async () => {
    const single = vi
      .fn()
      .mockResolvedValue({ data: null, error: new Error("connection reset") });
    const select = vi.fn().mockReturnValue({ single });
    const insert = vi.fn().mockReturnValue({ select });
    const from = vi.fn().mockReturnValue({ insert });
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from } as never);

    const result = await createProgramRecord(baseInput());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("Could not create the program. Please try again.");
    }
  });
});

describe("updateProgramProfile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("never writes program_code — it is immutable after creation regardless of what the input carries", async () => {
    const eq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ update });
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from } as never);

    const result = await updateProgramProfile("program-1", {
      ...baseInput(),
      programCode: "TAMPERED-999",
      name: "Renamed Program",
    });

    expect(result).toEqual({ ok: true, data: null });
    const updatePayload = update.mock.calls[0][0];
    expect(updatePayload).not.toHaveProperty("program_code");
    expect(updatePayload.name).toBe("Renamed Program");
  });

  // Edit/re-save regression: re-saving an already-decimal fee must not
  // round-trip it through anything lossy on the way back out either.
  it.each([
    ["50000.50", "0"],
    ["500.50", "0"],
    ["50000.99", "1000.50"],
    ["0.50", "0.50"],
  ])(
    "updates regular_fee=%s and registration_fee=%s as exact, unmodified decimal strings",
    async (regularFee, registrationFee) => {
      const eq = vi.fn().mockResolvedValue({ error: null });
      const update = vi.fn().mockReturnValue({ eq });
      const from = vi.fn().mockReturnValue({ update });
      vi.mocked(createSupabaseServerClient).mockResolvedValue({ from } as never);

      await updateProgramProfile("program-1", {
        ...baseInput(),
        regularFee,
        registrationFee,
      });

      const updatePayload = update.mock.calls[0][0];
      expect(updatePayload.regular_fee).toBe(regularFee);
      expect(updatePayload.registration_fee).toBe(registrationFee);
    },
  );
});

describe("findProgramByExactCode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the matching program when the exact code already exists", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: { id: "existing-1", name: "Existing Program" },
      error: null,
    });
    const eq = vi.fn().mockReturnValue({ maybeSingle });
    const select = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ select });
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from } as never);

    const result = await findProgramByExactCode("FSD-101");

    expect(result).toEqual({
      ok: true,
      data: { id: "existing-1", name: "Existing Program" },
    });
    expect(eq).toHaveBeenCalledWith("program_code", "FSD-101");
  });

  it("returns null when no program has that exact code (case-sensitive exact match)", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const eq = vi.fn().mockReturnValue({ maybeSingle });
    const select = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ select });
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from } as never);

    const result = await findProgramByExactCode("fsd-101");

    expect(result).toEqual({ ok: true, data: null });
  });
});

describe("getProgramCodePattern", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when no pattern is configured (the default, real-world state)", async () => {
    const maybeSingle = vi
      .fn()
      .mockResolvedValue({ data: { program_code_pattern: null }, error: null });
    const select = vi.fn().mockReturnValue({ maybeSingle });
    const from = vi.fn().mockReturnValue({ select });
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from } as never);

    const result = await getProgramCodePattern();

    expect(result).toEqual({ ok: true, data: null });
  });

  it("returns the configured pattern when set", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: { program_code_pattern: "^[A-Z]{2,4}-\\d{3,4}$" },
      error: null,
    });
    const select = vi.fn().mockReturnValue({ maybeSingle });
    const from = vi.fn().mockReturnValue({ select });
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from } as never);

    const result = await getProgramCodePattern();

    expect(result).toEqual({ ok: true, data: "^[A-Z]{2,4}-\\d{3,4}$" });
  });
});

describe("getProgramRelatedSummary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses count-only queries (never fetching full batch/enrollment rows) for the summary counts", async () => {
    // Each `.from("batches")...` call in the Promise.all chain gets its own
    // independent chainable query-builder mock (real supabase-js does the
    // same) that resolves to the "active"-filtered count only once `.eq`
    // has actually been called with status=active.
    function makeBatchQuery(
      baseResult: { count: number },
      activeResult: { count: number },
    ) {
      let filteredActive = false;
      const builder = {
        eq: vi.fn((column: string, value: string) => {
          if (column === "status" && value === "active") filteredActive = true;
          return builder;
        }),
        then: (
          resolve: (v: { count: number; error: null }) => void,
          reject: (e: unknown) => void,
        ) =>
          Promise.resolve({
            ...(filteredActive ? activeResult : baseResult),
            error: null,
          }).then(resolve, reject),
      };
      return builder;
    }

    const batchesSelect = vi
      .fn()
      .mockImplementation(() => makeBatchQuery({ count: 3 }, { count: 1 }));
    const enrollmentsEq = vi.fn().mockResolvedValue({ count: 5, error: null });
    const enrollmentsSelect = vi.fn().mockReturnValue({ eq: enrollmentsEq });

    const from = vi.fn((table: string) => {
      if (table === "batches") return { select: batchesSelect };
      if (table === "enrollments") return { select: enrollmentsSelect };
      throw new Error(`Unexpected table: ${table}`);
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from } as never);

    const result = await getProgramRelatedSummary("program-1");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({
        batchCount: 3,
        activeBatchCount: 1,
        enrollmentCount: 5,
      });
    }
    // head: true / count: "exact" — no row bodies requested.
    expect(batchesSelect).toHaveBeenCalledWith("id", { count: "exact", head: true });
    expect(enrollmentsSelect).toHaveBeenCalledWith("id", { count: "exact", head: true });
  });
});
