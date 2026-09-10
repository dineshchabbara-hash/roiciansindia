import "server-only";

import { randomBytes } from "node:crypto";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { DataResult } from "@/lib/data/dashboard";
import {
  findTrainerDuplicateMatches,
  type TrainerDuplicateMatch,
} from "@/lib/domain/trainers";
import type { TrainerProfileInput } from "@/lib/validation/trainers";

function fail<T>(message: string, error: unknown): DataResult<T> {
  console.error(`[trainers data] ${message}:`, error);
  return { ok: false, error: message };
}

const PAGE_SIZE_DEFAULT = 20;

// ---------------------------------------------------------------------------
// List / search / filter / pagination

export type TrainerListRow = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  status: "active" | "inactive";
};

export type TrainerSearchParams = {
  q?: string;
  status?: "active" | "inactive";
  page?: number;
  pageSize?: number;
};

export async function searchTrainers(params: TrainerSearchParams): Promise<
  DataResult<{
    trainers: TrainerListRow[];
    total: number;
    page: number;
    pageSize: number;
  }>
> {
  try {
    const supabase = await createSupabaseServerClient();
    const page = Math.max(1, params.page ?? 1);
    const pageSize = params.pageSize ?? PAGE_SIZE_DEFAULT;

    let query = supabase
      .from("trainers")
      .select("id, first_name, last_name, email, phone, status", { count: "exact" });

    if (params.status) query = query.eq("status", params.status);
    if (params.q && params.q.trim().length > 0) {
      const q = params.q.trim();
      query = query.or(
        `first_name.ilike.%${q}%,last_name.ilike.%${q}%,email.ilike.%${q}%,phone.ilike.%${q}%`,
      );
    }

    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    const { data, error, count } = await query
      .order("created_at", { ascending: false })
      .range(from, to);

    if (error) throw error;

    return {
      ok: true,
      data: {
        trainers: (data ?? []).map((row) => ({
          id: row.id,
          firstName: row.first_name,
          lastName: row.last_name,
          email: row.email,
          phone: row.phone,
          status: row.status,
        })),
        total: count ?? 0,
        page,
        pageSize,
      },
    };
  } catch (error) {
    return fail("Could not load the trainer list.", error);
  }
}

// ---------------------------------------------------------------------------
// Profile (core row)

export type TrainerProfile = {
  id: string;
  authUserId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  bio: string | null;
  specialization: string[];
  status: "active" | "inactive";
  createdAt: string;
};

export async function getTrainerProfile(id: string): Promise<DataResult<TrainerProfile>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("trainers")
      .select(
        "id, auth_user_id, first_name, last_name, email, phone, bio, specialization, status, created_at",
      )
      .eq("id", id)
      .maybeSingle();

    if (error) throw error;
    if (!data) return { ok: false, error: "Trainer not found." };

    return {
      ok: true,
      data: {
        id: data.id,
        authUserId: data.auth_user_id,
        firstName: data.first_name,
        lastName: data.last_name,
        email: data.email,
        phone: data.phone,
        bio: data.bio,
        specialization: data.specialization ?? [],
        status: data.status,
        createdAt: data.created_at,
      },
    };
  } catch (error) {
    return fail("Could not load the trainer profile.", error);
  }
}

// ---------------------------------------------------------------------------
// Read-only assignment context (Batch/Program Management themselves are out
// of Phase 6 scope — this only displays already-existing linked data).

export type TrainerAssignmentRow = {
  id: string;
  batchId: string;
  batchName: string;
  programName: string;
  batchStatus: string;
  isPrimary: boolean;
};

export async function getTrainerAssignments(
  trainerId: string,
): Promise<DataResult<TrainerAssignmentRow[]>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("batch_trainers")
      .select("id, is_primary, batch:batches(id, name, status, program:programs(name))")
      .eq("trainer_id", trainerId);

    if (error) throw error;

    const rows = (data ?? []) as unknown as Array<{
      id: string;
      is_primary: boolean;
      batch: {
        id: string;
        name: string;
        status: string;
        program: { name: string } | null;
      } | null;
    }>;

    return {
      ok: true,
      data: rows
        .filter((row) => row.batch !== null)
        .map((row) => ({
          id: row.id,
          batchId: row.batch!.id,
          batchName: row.batch!.name,
          programName: row.batch!.program?.name ?? "Unknown program",
          batchStatus: row.batch!.status,
          isPrimary: row.is_primary,
        })),
    };
  } catch (error) {
    return fail("Could not load assigned batches.", error);
  }
}

// ---------------------------------------------------------------------------
// Duplicate detection

type TrainerCandidateRow = {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
};

export async function findDuplicateTrainers(input: {
  email: string;
  phone: string | null;
}): Promise<DataResult<TrainerDuplicateMatch[]>> {
  try {
    const supabase = await createSupabaseServerClient();

    // Two independent, properly-parameterized queries rather than one
    // hand-built `.or()` filter string. supabase-js's own docs for `.or()`
    // state it "is used as-is and needs to follow PostgREST syntax — you
    // also need to make sure it's properly sanitized"; `.ilike()` has no
    // such caveat. This was found while tracing a real bug report (a
    // genuine phone duplicate wasn't flagged) — the combined OR-string
    // approach couldn't be fully verified safe for arbitrary admin-entered
    // email values, so it's replaced here with two simple, independently
    // correct queries whose results are merged before the precise matching
    // logic in lib/domain/trainers.ts runs. Each query is still only a
    // coarse prefilter (over-fetching is fine — findTrainerDuplicateMatches
    // decides what actually counts as a duplicate), so this can never
    // produce a false positive, only candidates to filter out.
    const emailResult = await supabase
      .from("trainers")
      .select("id, first_name, last_name, email, phone")
      .ilike("email", input.email.trim())
      .limit(50);
    if (emailResult.error) throw emailResult.error;

    let phoneRows: TrainerCandidateRow[] = [];
    if (input.phone) {
      const phoneDigitsTail = input.phone.replace(/\D/g, "").slice(-7);
      if (phoneDigitsTail) {
        const phoneResult = await supabase
          .from("trainers")
          .select("id, first_name, last_name, email, phone")
          .ilike("phone", `%${phoneDigitsTail}%`)
          .limit(50);
        if (phoneResult.error) throw phoneResult.error;
        phoneRows = phoneResult.data ?? [];
      }
    }

    const candidatesById = new Map<string, TrainerCandidateRow>();
    for (const row of [...(emailResult.data ?? []), ...phoneRows]) {
      candidatesById.set(row.id, row);
    }

    const matches = findTrainerDuplicateMatches(
      input,
      Array.from(candidatesById.values()).map((row) => ({
        id: row.id,
        firstName: row.first_name,
        lastName: row.last_name,
        email: row.email,
        phone: row.phone,
      })),
    );

    return { ok: true, data: matches };
  } catch (error) {
    return fail("Could not check for duplicate trainers. Please try again.", error);
  }
}

// ---------------------------------------------------------------------------
// Creation — trainers.auth_user_id is NOT NULL (unlike students, where a
// profile can exist without a portal login yet): the trainers table's own
// comment ("one per invited trainer auth account") and this NOT NULL
// constraint together confirm Trainer creation must provision a real
// Supabase Auth account in the same operation, not just a profile row.
// Mirrors the account-provisioning pattern already used by
// scripts/seed-demo-users.mjs / e2e/support/phase5-fixtures.ts: create the
// auth user with a random, never-surfaced password (the trainer sets their
// own via the existing "Forgot password" flow — no new invite-email
// mechanism introduced), then user_roles, then the trainers row itself.
//
// Rollback on partial failure: user_roles.auth_user_id is ON DELETE CASCADE
// from auth.users, so deleting the just-created auth user alone is enough
// to clean up an orphaned user_roles row if that insert succeeded but the
// trainers insert then failed — there is nothing else to separately roll
// back, and the trainers insert is always the last step, so a trainers row
// is never left referencing a half-created account.
export async function createTrainerRecord(
  input: TrainerProfileInput,
): Promise<DataResult<{ id: string }>> {
  const supabase = createSupabaseAdminClient();
  let authUserId: string | null = null;

  try {
    const temporaryPassword = randomBytes(24).toString("base64url");
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: input.email,
      password: temporaryPassword,
      email_confirm: true,
    });
    if (authError || !authData.user) {
      const message = authError?.message?.toLowerCase() ?? "";
      if (message.includes("already") && message.includes("regist")) {
        return {
          ok: false,
          error: "This email is already registered to another account.",
        };
      }
      throw authError ?? new Error("Auth user creation returned no user.");
    }
    authUserId = authData.user.id;

    const { error: roleError } = await supabase
      .from("user_roles")
      .insert({ auth_user_id: authUserId, role: "trainer" });
    if (roleError) throw roleError;

    const { data, error: insertError } = await supabase
      .from("trainers")
      .insert({
        auth_user_id: authUserId,
        first_name: input.firstName,
        last_name: input.lastName,
        email: input.email,
        phone: input.phone,
        bio: input.bio ?? null,
        specialization: input.specialization,
      })
      .select("id")
      .single();

    if (insertError) throw insertError;

    return { ok: true, data: { id: data.id } };
  } catch (error) {
    if (authUserId) {
      await supabase.auth.admin.deleteUser(authUserId).catch(() => {});
    }
    return fail("Could not create the trainer. Please try again.", error);
  }
}

// ---------------------------------------------------------------------------
// Profile update — auth_user_id, id, and email are never included here:
// email is part of the update payload (a trainer's contact email can
// change), but auth linkage itself is never touched by a profile edit.

export async function updateTrainerProfile(
  id: string,
  input: TrainerProfileInput,
): Promise<DataResult<null>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase
      .from("trainers")
      .update({
        first_name: input.firstName,
        last_name: input.lastName,
        email: input.email,
        phone: input.phone,
        bio: input.bio ?? null,
        specialization: input.specialization,
      })
      .eq("id", id);

    if (error) throw error;
    return { ok: true, data: null };
  } catch (error) {
    return fail("Could not save changes. Please try again.", error);
  }
}

export async function updateTrainerStatus(
  id: string,
  status: "active" | "inactive",
): Promise<DataResult<null>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.from("trainers").update({ status }).eq("id", id);
    if (error) throw error;
    return { ok: true, data: null };
  } catch (error) {
    return fail("Could not update the trainer's status. Please try again.", error);
  }
}
