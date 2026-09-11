import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { DataResult } from "@/lib/data/dashboard";
import type { DeliveryMode, DurationUnit, ProgramStatus } from "@/lib/domain/programs";
import type { ProgramProfileInput } from "@/lib/validation/programs";

function fail<T>(message: string, error: unknown): DataResult<T> {
  console.error(`[programs data] ${message}:`, error);
  return { ok: false, error: message };
}

const PAGE_SIZE_DEFAULT = 20;

// Postgres unique_violation. Used as a defense-in-depth backstop for a
// race between the pre-insert duplicate-code check and the insert itself —
// see createProgramRecord.
const POSTGRES_UNIQUE_VIOLATION = "23505";

// ---------------------------------------------------------------------------
// List / search / filter / pagination

export type ProgramListRow = {
  id: string;
  programCode: string;
  name: string;
  status: ProgramStatus;
  regularFee: string;
  durationValue: number | null;
  durationUnit: DurationUnit | null;
};

export type ProgramSearchParams = {
  q?: string;
  status?: ProgramStatus;
  page?: number;
  pageSize?: number;
};

export async function searchPrograms(params: ProgramSearchParams): Promise<
  DataResult<{
    programs: ProgramListRow[];
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
      .from("programs")
      .select(
        "id, program_code, name, status, regular_fee, duration_value, duration_unit",
        { count: "exact" },
      );

    if (params.status) query = query.eq("status", params.status);
    if (params.q && params.q.trim().length > 0) {
      const q = params.q.trim();
      query = query.or(
        `program_code.ilike.%${q}%,name.ilike.%${q}%,description.ilike.%${q}%,category.ilike.%${q}%`,
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
        programs: (data ?? []).map((row) => ({
          id: row.id,
          programCode: row.program_code,
          name: row.name,
          status: row.status,
          regularFee: row.regular_fee,
          durationValue: row.duration_value,
          durationUnit: row.duration_unit,
        })),
        total: count ?? 0,
        page,
        pageSize,
      },
    };
  } catch (error) {
    return fail("Could not load the program list.", error);
  }
}

// ---------------------------------------------------------------------------
// Profile (core row)

export type ProgramProfile = {
  id: string;
  programCode: string;
  name: string;
  description: string | null;
  category: string | null;
  durationValue: number | null;
  durationUnit: DurationUnit | null;
  deliveryMode: DeliveryMode | null;
  regularFee: string;
  registrationFee: string;
  taxRatePercent: string | null;
  status: ProgramStatus;
  certificateEligible: boolean;
  installmentsAllowed: boolean;
  createdAt: string;
};

export async function getProgramProfile(id: string): Promise<DataResult<ProgramProfile>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("programs")
      .select(
        "id, program_code, name, description, category, duration_value, duration_unit, delivery_mode, regular_fee, registration_fee, tax_rate_percent, status, certificate_eligible, installments_allowed, created_at",
      )
      .eq("id", id)
      .maybeSingle();

    if (error) throw error;
    if (!data) return { ok: false, error: "Program not found." };

    return {
      ok: true,
      data: {
        id: data.id,
        programCode: data.program_code,
        name: data.name,
        description: data.description,
        category: data.category,
        durationValue: data.duration_value,
        durationUnit: data.duration_unit,
        deliveryMode: data.delivery_mode,
        regularFee: data.regular_fee,
        registrationFee: data.registration_fee,
        taxRatePercent: data.tax_rate_percent,
        status: data.status,
        certificateEligible: data.certificate_eligible,
        installmentsAllowed: data.installments_allowed,
        createdAt: data.created_at,
      },
    };
  } catch (error) {
    return fail("Could not load the program profile.", error);
  }
}

// ---------------------------------------------------------------------------
// Read-only related context (Batch/Enrollment Management themselves are out
// of Phase 7 scope — this only displays already-existing linked data, using
// count-only queries so a program with many batches/enrollments never pulls
// full row sets just to show a number).

export type ProgramRelatedSummary = {
  batchCount: number;
  activeBatchCount: number;
  enrollmentCount: number;
};

export async function getProgramRelatedSummary(
  programId: string,
): Promise<DataResult<ProgramRelatedSummary>> {
  try {
    const supabase = await createSupabaseServerClient();

    const [batchCount, activeBatchCount, enrollmentCount] = await Promise.all([
      supabase
        .from("batches")
        .select("id", { count: "exact", head: true })
        .eq("program_id", programId),
      supabase
        .from("batches")
        .select("id", { count: "exact", head: true })
        .eq("program_id", programId)
        .eq("status", "active"),
      supabase
        .from("enrollments")
        .select("id", { count: "exact", head: true })
        .eq("program_id", programId),
    ]);

    if (batchCount.error) throw batchCount.error;
    if (activeBatchCount.error) throw activeBatchCount.error;
    if (enrollmentCount.error) throw enrollmentCount.error;

    return {
      ok: true,
      data: {
        batchCount: batchCount.count ?? 0,
        activeBatchCount: activeBatchCount.count ?? 0,
        enrollmentCount: enrollmentCount.count ?? 0,
      },
    };
  } catch (error) {
    return fail("Could not load related batch/enrollment counts.", error);
  }
}

export type ProgramBatchRow = {
  id: string;
  name: string;
  startDate: string;
  status: string;
};

export async function getProgramBatches(
  programId: string,
): Promise<DataResult<ProgramBatchRow[]>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("batches")
      .select("id, name, start_date, status")
      .eq("program_id", programId)
      .order("start_date", { ascending: false });

    if (error) throw error;

    return {
      ok: true,
      data: (data ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        startDate: row.start_date,
        status: row.status,
      })),
    };
  } catch (error) {
    return fail("Could not load batches for this program.", error);
  }
}

// ---------------------------------------------------------------------------
// Program code pattern (company_settings.program_code_pattern) — see
// lib/domain/programs.ts's isValidRegexPattern/matchesProgramCodePattern
// header comment for why this stays optional and never blocks creation on
// its own if misconfigured.

export async function getProgramCodePattern(): Promise<DataResult<string | null>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("company_settings")
      .select("program_code_pattern")
      .maybeSingle();

    if (error) throw error;
    return { ok: true, data: data?.program_code_pattern ?? null };
  } catch (error) {
    return fail("Could not load program code format settings.", error);
  }
}

// ---------------------------------------------------------------------------
// Duplicate program-code detection — a fast, friendly pre-check ahead of the
// real DB unique constraint (programs.program_code is `unique`, case-
// sensitive exact match; there is no case-insensitive index). This exists
// purely for a clear form error instead of a raw Postgres error; the DB
// constraint remains the actual source of truth (see createProgramRecord's
// unique_violation handling for the race-condition backstop).

export async function findProgramByExactCode(
  programCode: string,
): Promise<DataResult<{ id: string; name: string } | null>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("programs")
      .select("id, name")
      .eq("program_code", programCode)
      .maybeSingle();

    if (error) throw error;
    return { ok: true, data: data ?? null };
  } catch (error) {
    return fail("Could not check for a duplicate program code.", error);
  }
}

// ---------------------------------------------------------------------------
// Creation

export async function createProgramRecord(
  input: ProgramProfileInput,
): Promise<DataResult<{ id: string; programCode: string }>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("programs")
      .insert({
        program_code: input.programCode,
        name: input.name,
        description: input.description,
        category: input.category,
        duration_value: input.durationValue,
        duration_unit: input.durationUnit,
        delivery_mode: input.deliveryMode,
        regular_fee: input.regularFee,
        registration_fee: input.registrationFee,
        tax_rate_percent: input.taxRatePercent,
        certificate_eligible: input.certificateEligible,
        installments_allowed: input.installmentsAllowed,
      })
      .select("id, program_code")
      .single();

    if (error) {
      if (
        (error as { code?: string }).code === POSTGRES_UNIQUE_VIOLATION &&
        error.message.includes("program_code")
      ) {
        return {
          ok: false,
          error: "This program code is already in use. Choose a different code.",
        };
      }
      throw error;
    }

    return { ok: true, data: { id: data.id, programCode: data.program_code } };
  } catch (error) {
    return fail("Could not create the program. Please try again.", error);
  }
}

// ---------------------------------------------------------------------------
// Profile update — program_code is intentionally never included here: the
// architecture treats it as immutable after creation (DATABASE_SCHEMA.md /
// REQUIREMENTS.md §7 item 1 describe it as admin-defined at creation time,
// never regenerated or edited afterward), so even if a tampered request
// somehow carried a different value, it can never reach this update.

export async function updateProgramProfile(
  id: string,
  input: ProgramProfileInput,
): Promise<DataResult<null>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase
      .from("programs")
      .update({
        name: input.name,
        description: input.description,
        category: input.category,
        duration_value: input.durationValue,
        duration_unit: input.durationUnit,
        delivery_mode: input.deliveryMode,
        regular_fee: input.regularFee,
        registration_fee: input.registrationFee,
        tax_rate_percent: input.taxRatePercent,
        certificate_eligible: input.certificateEligible,
        installments_allowed: input.installmentsAllowed,
      })
      .eq("id", id);

    if (error) throw error;
    return { ok: true, data: null };
  } catch (error) {
    return fail("Could not save changes. Please try again.", error);
  }
}

export async function updateProgramStatus(
  id: string,
  status: ProgramStatus,
): Promise<DataResult<null>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.from("programs").update({ status }).eq("id", id);
    if (error) throw error;
    return { ok: true, data: null };
  } catch (error) {
    return fail("Could not update the program's status. Please try again.", error);
  }
}
