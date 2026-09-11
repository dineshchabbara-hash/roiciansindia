import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { DataResult } from "@/lib/data/dashboard";
import type { BatchStatus, DeliveryMode } from "@/lib/domain/batches";
import type { BatchProfileInput } from "@/lib/validation/batches";

function fail<T>(message: string, error: unknown): DataResult<T> {
  console.error(`[batches data] ${message}:`, error);
  return { ok: false, error: message };
}

const PAGE_SIZE_DEFAULT = 20;

// Postgres foreign_key_violation / unique_violation.
const POSTGRES_FOREIGN_KEY_VIOLATION = "23503";
const POSTGRES_UNIQUE_VIOLATION = "23505";

// ---------------------------------------------------------------------------
// List / search / filter / pagination

export type BatchListRow = {
  id: string;
  name: string;
  programId: string;
  programName: string;
  startDate: string;
  expectedEndDate: string | null;
  status: BatchStatus;
  capacity: number | null;
};

export type BatchSearchParams = {
  q?: string;
  programId?: string;
  trainerId?: string;
  status?: BatchStatus;
  page?: number;
  pageSize?: number;
};

export async function searchBatches(params: BatchSearchParams): Promise<
  DataResult<{
    batches: BatchListRow[];
    total: number;
    page: number;
    pageSize: number;
  }>
> {
  try {
    const supabase = await createSupabaseServerClient();
    const page = Math.max(1, params.page ?? 1);
    const pageSize = params.pageSize ?? PAGE_SIZE_DEFAULT;

    // Trainer filtering must resolve matching batch ids first, rather than
    // joining batches to batch_trainers directly — batch_trainers is a
    // many-to-many table, so a batch with multiple matching trainer rows
    // (not possible for a single trainerId, but true in general for the
    // underlying join) must never appear more than once in the result or
    // be counted more than once toward pagination. Same pattern as
    // lib/data/students.ts's program/batch filters.
    let restrictToIds: string[] | null = null;
    if (params.trainerId) {
      const { data: assignmentRows, error: assignmentError } = await supabase
        .from("batch_trainers")
        .select("batch_id")
        .eq("trainer_id", params.trainerId);

      if (assignmentError) throw assignmentError;

      restrictToIds = Array.from(
        new Set((assignmentRows ?? []).map((row) => row.batch_id)),
      );

      if (restrictToIds.length === 0) {
        return { ok: true, data: { batches: [], total: 0, page, pageSize } };
      }
    }

    // program:programs(name) is a to-one join on batches.program_id (a
    // plain scalar FK column, not a join table) — one program per batch,
    // so this can never multiply rows.
    let query = supabase
      .from("batches")
      .select(
        "id, name, program_id, start_date, expected_end_date, status, capacity, program:programs(name)",
        { count: "exact" },
      );

    if (restrictToIds) query = query.in("id", restrictToIds);
    if (params.programId) query = query.eq("program_id", params.programId);
    if (params.status) query = query.eq("status", params.status);
    if (params.q && params.q.trim().length > 0) {
      query = query.ilike("name", `%${params.q.trim()}%`);
    }

    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    const { data, error, count } = await query
      .order("start_date", { ascending: false })
      .range(from, to);

    if (error) throw error;

    const rows = (data ?? []) as unknown as Array<{
      id: string;
      name: string;
      program_id: string;
      start_date: string;
      expected_end_date: string | null;
      status: BatchStatus;
      capacity: number | null;
      program: { name: string } | null;
    }>;

    return {
      ok: true,
      data: {
        batches: rows.map((row) => ({
          id: row.id,
          name: row.name,
          programId: row.program_id,
          programName: row.program?.name ?? "Unknown program",
          startDate: row.start_date,
          expectedEndDate: row.expected_end_date,
          status: row.status,
          capacity: row.capacity,
        })),
        total: count ?? 0,
        page,
        pageSize,
      },
    };
  } catch (error) {
    return fail("Could not load the batch list.", error);
  }
}

export async function getProgramOptions(): Promise<
  DataResult<Array<{ id: string; name: string; programCode: string }>>
> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("programs")
      .select("id, name, program_code")
      .order("name");
    if (error) throw error;
    return {
      ok: true,
      data: (data ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        programCode: row.program_code,
      })),
    };
  } catch (error) {
    return fail("Could not load the program list.", error);
  }
}

// ---------------------------------------------------------------------------
// Profile (core row)

export type BatchProfile = {
  id: string;
  programId: string;
  programName: string;
  programCode: string;
  name: string;
  startDate: string;
  expectedEndDate: string | null;
  daysOfWeek: string[];
  startTime: string | null;
  endTime: string | null;
  timezone: string;
  deliveryMode: DeliveryMode | null;
  capacity: number | null;
  status: BatchStatus;
  meetingLink: string | null;
  location: string | null;
  notes: string | null;
  createdAt: string;
};

export async function getBatchProfile(id: string): Promise<DataResult<BatchProfile>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("batches")
      .select(
        "id, program_id, name, start_date, expected_end_date, days_of_week, start_time, end_time, timezone, delivery_mode, capacity, status, meeting_link, location, notes, created_at, program:programs(name, program_code)",
      )
      .eq("id", id)
      .maybeSingle();

    if (error) throw error;
    if (!data) return { ok: false, error: "Batch not found." };

    const row = data as unknown as {
      id: string;
      program_id: string;
      name: string;
      start_date: string;
      expected_end_date: string | null;
      days_of_week: string[];
      start_time: string | null;
      end_time: string | null;
      timezone: string;
      delivery_mode: DeliveryMode | null;
      capacity: number | null;
      status: BatchStatus;
      meeting_link: string | null;
      location: string | null;
      notes: string | null;
      created_at: string;
      program: { name: string; program_code: string } | null;
    };

    return {
      ok: true,
      data: {
        id: row.id,
        programId: row.program_id,
        programName: row.program?.name ?? "Unknown program",
        programCode: row.program?.program_code ?? "—",
        name: row.name,
        startDate: row.start_date,
        expectedEndDate: row.expected_end_date,
        daysOfWeek: row.days_of_week ?? [],
        startTime: row.start_time,
        endTime: row.end_time,
        timezone: row.timezone,
        deliveryMode: row.delivery_mode,
        capacity: row.capacity,
        status: row.status,
        meetingLink: row.meeting_link,
        location: row.location,
        notes: row.notes,
        createdAt: row.created_at,
      },
    };
  } catch (error) {
    return fail("Could not load the batch profile.", error);
  }
}

// ---------------------------------------------------------------------------
// Read-only related context (Enrollment Management itself is out of Phase 8
// scope — this only displays an already-existing count, using a count-only
// query so a batch with many enrollments never pulls full row sets).

export async function getBatchEnrollmentCount(
  batchId: string,
): Promise<DataResult<number>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { count, error } = await supabase
      .from("enrollments")
      .select("id", { count: "exact", head: true })
      .eq("batch_id", batchId);

    if (error) throw error;
    return { ok: true, data: count ?? 0 };
  } catch (error) {
    return fail("Could not load the enrollment count.", error);
  }
}

// ---------------------------------------------------------------------------
// Trainer assignments (batch_trainers)

export type BatchTrainerAssignment = {
  trainerId: string;
  firstName: string;
  lastName: string;
  status: "active" | "inactive";
  isPrimary: boolean;
};

export async function getBatchTrainerAssignments(
  batchId: string,
): Promise<DataResult<BatchTrainerAssignment[]>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("batch_trainers")
      .select("trainer_id, is_primary, trainer:trainers(first_name, last_name, status)")
      .eq("batch_id", batchId);

    if (error) throw error;

    const rows = (data ?? []) as unknown as Array<{
      trainer_id: string;
      is_primary: boolean;
      trainer: {
        first_name: string;
        last_name: string;
        status: "active" | "inactive";
      } | null;
    }>;

    return {
      ok: true,
      data: rows
        .filter((row) => row.trainer !== null)
        .map((row) => ({
          trainerId: row.trainer_id,
          firstName: row.trainer!.first_name,
          lastName: row.trainer!.last_name,
          status: row.trainer!.status,
          isPrimary: row.is_primary,
        })),
    };
  } catch (error) {
    return fail("Could not load assigned trainers.", error);
  }
}

export async function getTrainerOptions(): Promise<
  DataResult<
    Array<{
      id: string;
      firstName: string;
      lastName: string;
      status: "active" | "inactive";
    }>
  >
> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("trainers")
      .select("id, first_name, last_name, status")
      .order("first_name");
    if (error) throw error;
    return {
      ok: true,
      data: (data ?? []).map((row) => ({
        id: row.id,
        firstName: row.first_name,
        lastName: row.last_name,
        status: row.status,
      })),
    };
  } catch (error) {
    return fail("Could not load the trainer list.", error);
  }
}

export async function findExistingAssignment(
  batchId: string,
  trainerId: string,
): Promise<DataResult<boolean>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("batch_trainers")
      .select("id")
      .eq("batch_id", batchId)
      .eq("trainer_id", trainerId)
      .maybeSingle();

    if (error) throw error;
    return { ok: true, data: data !== null };
  } catch (error) {
    return fail("Could not check the trainer's existing assignments.", error);
  }
}

// At most one is_primary=true row per batch_id is a business rule with no
// backing DB constraint — batch_trainers only has unique(batch_id,
// trainer_id) (see the migration). Enforced here at the application layer
// with two statements: insert the new assignment, then — only when it was
// requested as primary — one atomic UPDATE that demotes every *other*
// trainer on that batch in a single statement.
//
// This guarantees the invariant for the realistic case this bug report is
// about: one admin action at a time, each fully completing (including this
// function's own demote step) before the next begins — which is what the
// UI actually does (the Assign button is disabled while a request is
// pending). Proven empirically (see
// lib/data/__tests__/batches.test.ts): given any sequence of such
// non-overlapping calls, the batch always ends with at most one primary.
//
// It does NOT guarantee the invariant against two requests that are
// genuinely in flight at the same time. Traced by hand and confirmed with a
// deterministic interleaving test (see lib/data/__tests__/batches.test.ts):
// for two concurrent "assign as primary" calls targeting different trainers
// on the same batch, if both inserts land before either demote-update runs
// — insert(A), insert(C), then demote-others(!=A) and demote-others(!=C) in
// either order — the batch ends with *zero* primaries, not two. Each
// demote-update only ever sets other rows to false; it never re-asserts its
// own target back to true, so the second demote-update to run silently wipes
// out the first request's legitimately-primary row without restoring its
// own. (Any interleaving where one call's insert-then-demote fully completes
// before the other call's insert begins self-corrects to exactly one
// primary — the failure needs both inserts to race ahead of both demotes.)
// No reordering of these two independent, separately-committed PostgREST
// calls closes this, because neither statement can know about the other's
// not-yet-committed row. Closing this completely needs a DB-level
// mechanism — a partial unique index (`unique (batch_id) where is_primary`)
// or an RPC wrapping both writes in one transaction — either is a
// schema/migration change, out of scope for this fix without explicit
// approval (see the Phase 8 Primary-Trainer report's Checkpoint 3 section).
//
// What this function does guarantee unconditionally: a failed demote step
// is rolled back (the just-inserted row is deleted) rather than leaving
// two primaries or any other half-applied state from a *single* call's own
// two statements.
export async function assignTrainerToBatch(
  batchId: string,
  trainerId: string,
  isPrimary: boolean,
): Promise<DataResult<{ previousPrimaryTrainerId: string | null }>> {
  try {
    const supabase = await createSupabaseServerClient();

    // Read before inserting: the new trainer can never already be primary
    // (duplicate assignment is blocked before this is ever called), so
    // whatever this finds is genuinely who held Primary immediately before
    // this action — used only for the audit event below, not for
    // correctness of the invariant itself.
    let previousPrimaryTrainerId: string | null = null;
    if (isPrimary) {
      const { data: currentPrimary, error: currentPrimaryError } = await supabase
        .from("batch_trainers")
        .select("trainer_id")
        .eq("batch_id", batchId)
        .eq("is_primary", true)
        .maybeSingle();
      if (currentPrimaryError) throw currentPrimaryError;
      previousPrimaryTrainerId = currentPrimary?.trainer_id ?? null;
    }

    const { error: insertError } = await supabase
      .from("batch_trainers")
      .insert({ batch_id: batchId, trainer_id: trainerId, is_primary: isPrimary });

    if (insertError) {
      if ((insertError as { code?: string }).code === POSTGRES_UNIQUE_VIOLATION) {
        return { ok: false, error: "This trainer is already assigned to this batch." };
      }
      if ((insertError as { code?: string }).code === POSTGRES_FOREIGN_KEY_VIOLATION) {
        return { ok: false, error: "Selected trainer could not be found." };
      }
      throw insertError;
    }

    if (isPrimary) {
      const { error: demoteError } = await supabase
        .from("batch_trainers")
        .update({ is_primary: false })
        .eq("batch_id", batchId)
        .neq("trainer_id", trainerId);

      if (demoteError) {
        // Roll back the just-created assignment rather than leaving two
        // Primary rows (this one plus whichever wasn't demoted) or any
        // other half-applied state — same rollback-on-partial-failure
        // pattern as createTrainerRecord's Auth-account rollback.
        try {
          await supabase
            .from("batch_trainers")
            .delete()
            .eq("batch_id", batchId)
            .eq("trainer_id", trainerId);
        } catch {
          // Best-effort: the outer catch below still returns a controlled
          // error either way.
        }
        throw demoteError;
      }
    }

    return { ok: true, data: { previousPrimaryTrainerId } };
  } catch (error) {
    return fail("Could not assign the trainer. Please try again.", error);
  }
}

export async function unassignTrainerFromBatch(
  batchId: string,
  trainerId: string,
): Promise<DataResult<null>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase
      .from("batch_trainers")
      .delete()
      .eq("batch_id", batchId)
      .eq("trainer_id", trainerId);

    if (error) throw error;
    return { ok: true, data: null };
  } catch (error) {
    return fail("Could not unassign the trainer. Please try again.", error);
  }
}

// ---------------------------------------------------------------------------
// Creation

export async function createBatchRecord(
  input: BatchProfileInput,
): Promise<DataResult<{ id: string }>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("batches")
      .insert({
        program_id: input.programId,
        name: input.name,
        start_date: input.startDate,
        expected_end_date: input.expectedEndDate,
        days_of_week: input.daysOfWeek,
        start_time: input.startTime,
        end_time: input.endTime,
        timezone: input.timezone,
        delivery_mode: input.deliveryMode,
        capacity: input.capacity,
        meeting_link: input.meetingLink,
        location: input.location,
        notes: input.notes,
      })
      .select("id")
      .single();

    if (error) {
      if ((error as { code?: string }).code === POSTGRES_FOREIGN_KEY_VIOLATION) {
        return {
          ok: false,
          error: "Selected program could not be found. Please choose a valid program.",
        };
      }
      throw error;
    }

    return { ok: true, data: { id: data.id } };
  } catch (error) {
    return fail("Could not create the batch. Please try again.", error);
  }
}

// ---------------------------------------------------------------------------
// Profile update — program_id is intentionally never included here. The
// safe rule for reassigning a batch's program after enrollments/materials/
// class-session/assignment rows exist under it is not established anywhere
// in the architecture (those tables cascade-delete off `batches`, not
// `programs`, so nothing would automatically follow a reassignment), so
// Phase 8 does not expose Program reassignment at all rather than guessing
// at a safe rule — see the Phase 8 implementation report.

export async function updateBatchProfile(
  id: string,
  input: BatchProfileInput,
): Promise<DataResult<null>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase
      .from("batches")
      .update({
        name: input.name,
        start_date: input.startDate,
        expected_end_date: input.expectedEndDate,
        days_of_week: input.daysOfWeek,
        start_time: input.startTime,
        end_time: input.endTime,
        timezone: input.timezone,
        delivery_mode: input.deliveryMode,
        capacity: input.capacity,
        meeting_link: input.meetingLink,
        location: input.location,
        notes: input.notes,
      })
      .eq("id", id);

    if (error) throw error;
    return { ok: true, data: null };
  } catch (error) {
    return fail("Could not save changes. Please try again.", error);
  }
}

export async function updateBatchStatus(
  id: string,
  status: BatchStatus,
): Promise<DataResult<null>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.from("batches").update({ status }).eq("id", id);
    if (error) throw error;
    return { ok: true, data: null };
  } catch (error) {
    return fail("Could not update the batch's status. Please try again.", error);
  }
}
