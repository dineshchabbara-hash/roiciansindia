import { describe, expect, it, vi, beforeEach } from "vitest";

// See lib/data/__tests__/trainers.test.ts for why `server-only` itself must
// be mocked to import the real data-layer module under Vitest.
vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  createClassSession,
  getClassSession,
  getClassSessionsForBatch,
  updateClassSession,
  updateClassSessionStatus,
} from "@/lib/data/class-sessions";
import type { ClassSessionInput } from "@/lib/validation/class-sessions";

function baseInput(): ClassSessionInput {
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

function joinRow(overrides: Record<string, unknown> = {}) {
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
    created_at: "2026-01-01T00:00:00.000Z",
    trainer: null,
    ...overrides,
  };
}

describe("getClassSessionsForBatch", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists sessions for the given batch ordered by date/time", async () => {
    const order2 = vi.fn().mockResolvedValue({ data: [joinRow()], error: null });
    const order1 = vi.fn().mockReturnValue({ order: order2 });
    const eq = vi.fn().mockReturnValue({ order: order1 });
    const select = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ select });
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from } as never);

    const result = await getClassSessionsForBatch("batch-1");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual([
        {
          id: "session-1",
          batchId: "batch-1",
          trainerId: null,
          trainerName: null,
          sessionDate: "2026-09-01",
          startTime: "09:00:00",
          endTime: "11:00:00",
          topic: "Introduction",
          description: null,
          meetingLink: null,
          status: "scheduled",
          notes: null,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ]);
    }
    expect(eq).toHaveBeenCalledWith("batch_id", "batch-1");
  });
});

describe("getClassSession", () => {
  beforeEach(() => vi.clearAllMocks());

  it("filters by both the session id and the expected batch id", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: joinRow(), error: null });
    const eq2 = vi.fn().mockReturnValue({ maybeSingle });
    const eq1 = vi.fn().mockReturnValue({ eq: eq2 });
    const select = vi.fn().mockReturnValue({ eq: eq1 });
    const from = vi.fn().mockReturnValue({ select });
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from } as never);

    const result = await getClassSession("batch-1", "session-1");

    expect(result.ok).toBe(true);
    expect(eq1).toHaveBeenCalledWith("id", "session-1");
    expect(eq2).toHaveBeenCalledWith("batch_id", "batch-1");
  });

  it("returns the same not-found error for a nonexistent id and for a session on a different batch", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const eq2 = vi.fn().mockReturnValue({ maybeSingle });
    const eq1 = vi.fn().mockReturnValue({ eq: eq2 });
    const select = vi.fn().mockReturnValue({ eq: eq1 });
    const from = vi.fn().mockReturnValue({ select });
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from } as never);

    const result = await getClassSession("batch-1", "mismatched-session");
    expect(result).toEqual({ ok: false, error: "Class session not found." });
  });
});

describe("createClassSession", () => {
  beforeEach(() => vi.clearAllMocks());

  it("inserts the session scoped to the given batch and returns its id", async () => {
    const single = vi.fn().mockResolvedValue({ data: { id: "session-1" }, error: null });
    const select = vi.fn().mockReturnValue({ single });
    const insert = vi.fn().mockReturnValue({ select });
    const from = vi.fn().mockReturnValue({ insert });
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from } as never);

    const result = await createClassSession("batch-1", baseInput());

    expect(result).toEqual({ ok: true, data: { id: "session-1" } });
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ batch_id: "batch-1", session_date: "2026-09-01" }),
    );
  });

  it("translates a foreign_key_violation on batch_id into a clear error", async () => {
    const single = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "23503", message: "insert or update violates foreign key" },
    });
    const select = vi.fn().mockReturnValue({ single });
    const insert = vi.fn().mockReturnValue({ select });
    const from = vi.fn().mockReturnValue({ insert });
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from } as never);

    const result = await createClassSession("missing-batch", baseInput());
    expect(result).toEqual({ ok: false, error: "Selected batch could not be found." });
  });
});

describe("updateClassSession", () => {
  beforeEach(() => vi.clearAllMocks());

  it("updates the session's fields, never its batch_id or trainer_id", async () => {
    const eq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ update });
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from } as never);

    const result = await updateClassSession("session-1", baseInput());

    expect(result).toEqual({ ok: true, data: null });
    const updatePayload = update.mock.calls[0][0];
    expect(updatePayload).not.toHaveProperty("batch_id");
    expect(updatePayload).not.toHaveProperty("trainer_id");
    expect(eq).toHaveBeenCalledWith("id", "session-1");
  });
});

describe("updateClassSessionStatus", () => {
  beforeEach(() => vi.clearAllMocks());

  it("updates only the status column", async () => {
    const eq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ update });
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from } as never);

    const result = await updateClassSessionStatus("session-1", "completed");

    expect(result).toEqual({ ok: true, data: null });
    expect(update).toHaveBeenCalledWith({ status: "completed" });
  });
});
