"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getCurrentUserContext } from "@/lib/auth/session";
import { isAdminOrSuperAdmin } from "@/lib/domain/rbac";
import {
  createProgramRecord,
  findProgramByExactCode,
  getProgramCodePattern,
  getProgramProfile,
  updateProgramProfile,
  updateProgramStatus,
} from "@/lib/data/programs";
import { writeAuditLog } from "@/lib/data/audit-log";
import { isValidRegexPattern, matchesProgramCodePattern } from "@/lib/domain/programs";
import { programProfileSchema, programStatusSchema } from "@/lib/validation/programs";

const NOT_AUTHORIZED = "You are not authorized to perform this action.";

export type SubmittedProgramValues = {
  programCode: string;
  name: string;
  description: string;
  category: string;
  durationValue: string;
  durationUnit: string;
  deliveryMode: string;
  regularFee: string;
  registrationFee: string;
  taxRatePercent: string;
  certificateEligible: string;
  installmentsAllowed: string;
};

export type ProgramFormState = {
  formError?: string;
  fieldErrors?: Partial<Record<string, string[]>>;
  success?: boolean;
  // Same React 19 form-reset problem/fix as Student/Trainer Management's
  // FormState types — see StudentFormState's comment for the full
  // explanation of why submitted values must round-trip through state.
  submittedValues?: SubmittedProgramValues;
};

function profileInputFromFormData(formData: FormData) {
  return {
    programCode: formData.get("programCode"),
    name: formData.get("name"),
    description: formData.get("description"),
    category: formData.get("category"),
    durationValue: formData.get("durationValue"),
    durationUnit: formData.get("durationUnit"),
    deliveryMode: formData.get("deliveryMode"),
    regularFee: formData.get("regularFee"),
    registrationFee: formData.get("registrationFee"),
    taxRatePercent: formData.get("taxRatePercent"),
    certificateEligible: formData.get("certificateEligible"),
    installmentsAllowed: formData.get("installmentsAllowed"),
  };
}

function submittedValuesFromFormData(formData: FormData): SubmittedProgramValues {
  const asString = (value: FormDataEntryValue | null) =>
    typeof value === "string" ? value : "";
  const raw = profileInputFromFormData(formData);
  return {
    programCode: asString(raw.programCode),
    name: asString(raw.name),
    description: asString(raw.description),
    category: asString(raw.category),
    durationValue: asString(raw.durationValue),
    durationUnit: asString(raw.durationUnit),
    deliveryMode: asString(raw.deliveryMode),
    regularFee: asString(raw.regularFee),
    registrationFee: asString(raw.registrationFee),
    taxRatePercent: asString(raw.taxRatePercent),
    certificateEligible: raw.certificateEligible === "on" ? "on" : "",
    installmentsAllowed: raw.installmentsAllowed === "on" ? "on" : "",
  };
}

export async function createProgramAction(
  _prevState: ProgramFormState,
  formData: FormData,
): Promise<ProgramFormState> {
  const ctx = await getCurrentUserContext();
  if (!ctx || !isAdminOrSuperAdmin(ctx.role)) {
    return { formError: NOT_AUTHORIZED };
  }

  const submittedValues = submittedValuesFromFormData(formData);

  const parsed = programProfileSchema.safeParse(profileInputFromFormData(formData));
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors, submittedValues };
  }

  // Optional admin-configured format check (company_settings.program_code_pattern
  // — see lib/domain/programs.ts's header comment). Checked before the
  // uniqueness check so a malformed code never gets as far as a duplicate
  // lookup.
  const patternResult = await getProgramCodePattern();
  if (!patternResult.ok) {
    return { formError: patternResult.error, submittedValues };
  }
  const pattern = patternResult.data;
  if (
    pattern &&
    isValidRegexPattern(pattern) &&
    !matchesProgramCodePattern(parsed.data.programCode, pattern)
  ) {
    return {
      fieldErrors: {
        programCode: ["This program code does not match the required format."],
      },
      submittedValues,
    };
  }

  // Duplicate program-code is a hard block with no override — programs.
  // program_code has a real DB unique constraint and REQUIREMENTS.md §7
  // item 1 describes it as admin-defined but enforced unique, with no
  // documented override/duplicate-management workflow like Student/Trainer
  // duplicate detection. This pre-check exists only to surface a clear form
  // error instead of a raw Postgres error; createProgramRecord's own
  // unique_violation handling is the real backstop for a race.
  const duplicateResult = await findProgramByExactCode(parsed.data.programCode);
  if (!duplicateResult.ok) {
    return { formError: duplicateResult.error, submittedValues };
  }
  if (duplicateResult.data) {
    return {
      fieldErrors: {
        programCode: [
          `This program code is already used by "${duplicateResult.data.name}". Program codes must be unique.`,
        ],
      },
      submittedValues,
    };
  }

  const created = await createProgramRecord(parsed.data);
  if (!created.ok) {
    return { formError: created.error, submittedValues };
  }

  await writeAuditLog({
    actorAuthUserId: ctx.authUserId,
    actorRole: ctx.role,
    action: "program.create",
    entityType: "program",
    entityId: created.data.id,
    after: { programCode: created.data.programCode },
  });

  redirect(`/admin/programs/${created.data.id}`);
}

export async function updateProgramAction(
  programId: string,
  _prevState: ProgramFormState,
  formData: FormData,
): Promise<ProgramFormState> {
  const ctx = await getCurrentUserContext();
  if (!ctx || !isAdminOrSuperAdmin(ctx.role)) {
    return { formError: NOT_AUTHORIZED };
  }

  const submittedValues = submittedValuesFromFormData(formData);

  const parsed = programProfileSchema.safeParse(profileInputFromFormData(formData));
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors, submittedValues };
  }

  const before = await getProgramProfile(programId);
  const result = await updateProgramProfile(programId, parsed.data);
  if (!result.ok) {
    return { formError: result.error, submittedValues };
  }

  // program_code is deliberately excluded: it is immutable after creation
  // (see updateProgramProfile's comment) and is never part of this diff.
  const changedFields = before.ok
    ? Object.entries({
        name: parsed.data.name,
        description: parsed.data.description,
        category: parsed.data.category,
        durationValue: parsed.data.durationValue,
        durationUnit: parsed.data.durationUnit,
        deliveryMode: parsed.data.deliveryMode,
        regularFee: parsed.data.regularFee,
        registrationFee: parsed.data.registrationFee,
        taxRatePercent: parsed.data.taxRatePercent,
        certificateEligible: parsed.data.certificateEligible,
        installmentsAllowed: parsed.data.installmentsAllowed,
      })
        .filter(([key, value]) => {
          const beforeValue = (before.data as unknown as Record<string, unknown>)[key];
          return beforeValue !== value;
        })
        .map(([key]) => key)
    : [];

  await writeAuditLog({
    actorAuthUserId: ctx.authUserId,
    actorRole: ctx.role,
    action: "program.update",
    entityType: "program",
    entityId: programId,
    after: { changedFields },
  });

  redirect(`/admin/programs/${programId}`);
}

export async function setProgramStatusAction(
  programId: string,
  _prevState: ProgramFormState,
  formData: FormData,
): Promise<ProgramFormState> {
  const ctx = await getCurrentUserContext();
  if (!ctx || !isAdminOrSuperAdmin(ctx.role)) {
    return { formError: NOT_AUTHORIZED };
  }

  const parsed = programStatusSchema.safeParse({ status: formData.get("status") });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const before = await getProgramProfile(programId);
  const result = await updateProgramStatus(programId, parsed.data.status);
  if (!result.ok) {
    return { formError: result.error };
  }

  await writeAuditLog({
    actorAuthUserId: ctx.authUserId,
    actorRole: ctx.role,
    action: "program.status_change",
    entityType: "program",
    entityId: programId,
    before: before.ok ? { status: before.data.status } : null,
    after: { status: parsed.data.status },
  });

  revalidatePath(`/admin/programs/${programId}`);
  return { success: true };
}
