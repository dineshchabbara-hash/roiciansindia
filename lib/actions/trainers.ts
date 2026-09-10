"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getCurrentUserContext } from "@/lib/auth/session";
import { isAdminOrSuperAdmin } from "@/lib/domain/rbac";
import {
  createTrainerRecord,
  findDuplicateTrainers,
  getTrainerProfile,
  updateTrainerProfile,
  updateTrainerStatus,
} from "@/lib/data/trainers";
import { writeAuditLog } from "@/lib/data/audit-log";
import {
  TRAINER_DUPLICATE_REASON_LABELS,
  type TrainerDuplicateMatchReason,
} from "@/lib/domain/trainers";
import {
  duplicateOverrideSchema,
  trainerProfileSchema,
  trainerStatusSchema,
} from "@/lib/validation/trainers";

const NOT_AUTHORIZED = "You are not authorized to perform this action.";

export type SubmittedTrainerValues = {
  firstName: string;
  lastName: string;
  email: string;
  phoneCountry: string;
  phone: string;
  bio: string;
  specialization: string;
};

export type TrainerFormState = {
  formError?: string;
  fieldErrors?: Partial<Record<string, string[]>>;
  success?: boolean;
  duplicates?: Array<{
    trainerId: string;
    name: string;
    reasons: TrainerDuplicateMatchReason[];
    reasonLabels: string[];
  }>;
  // Same React 19 form-reset problem/fix as Student Management's
  // StudentFormState — see the comment there for the full explanation.
  submittedOverride?: { confirmOverride: boolean; overrideReason: string };
  submittedValues?: SubmittedTrainerValues;
};

function profileInputFromFormData(formData: FormData) {
  return {
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName"),
    email: formData.get("email"),
    phoneCountry: formData.get("phoneCountry"),
    phone: formData.get("phone"),
    bio: formData.get("bio"),
    specialization: formData.get("specialization"),
  };
}

function submittedValuesFromFormData(formData: FormData): SubmittedTrainerValues {
  const asString = (value: FormDataEntryValue | null) =>
    typeof value === "string" ? value : "";
  const raw = profileInputFromFormData(formData);
  return {
    firstName: asString(raw.firstName),
    lastName: asString(raw.lastName),
    email: asString(raw.email),
    phoneCountry: asString(raw.phoneCountry),
    phone: asString(raw.phone),
    bio: asString(raw.bio),
    specialization: asString(raw.specialization),
  };
}

export async function createTrainerAction(
  _prevState: TrainerFormState,
  formData: FormData,
): Promise<TrainerFormState> {
  const ctx = await getCurrentUserContext();
  if (!ctx || !isAdminOrSuperAdmin(ctx.role)) {
    return { formError: NOT_AUTHORIZED };
  }

  const submittedValues = submittedValuesFromFormData(formData);

  const parsed = trainerProfileSchema.safeParse(profileInputFromFormData(formData));
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors, submittedValues };
  }

  const confirmOverride = formData.get("confirmOverride") === "on";
  const overrideReasonRaw = formData.get("overrideReason");

  // Computed once, up front, regardless of confirmOverride — same reasoning
  // as createStudentAction: reused both for the pre-create block and, once
  // confirmed, as the source of truth for the override audit entry.
  const duplicateResult = await findDuplicateTrainers({
    email: parsed.data.email,
    phone: parsed.data.phone,
  });

  if (!duplicateResult.ok) {
    return { formError: duplicateResult.error, submittedValues };
  }

  const duplicateMatches = duplicateResult.data;

  // Duplicate email is a hard block with no override, unconditionally,
  // before confirmOverride/overrideReason are even inspected — every
  // trainer requires a real, unique Supabase Auth account, so a duplicate
  // email can never actually be created regardless of what the admin
  // confirms (see createTrainerRecord's own Auth-level uniqueness check).
  // Checking this first, and returning before any override logic runs,
  // is what makes it impossible to bypass with a crafted/tampered
  // confirmOverride=on + overrideReason in the submitted FormData — there
  // is no code path from here that reaches createTrainerRecord while an
  // email match exists. If a candidate matches on both email and phone,
  // this still fires first, so the email block always takes precedence.
  if (duplicateMatches.some((match) => match.reasons.includes("email"))) {
    return {
      fieldErrors: {
        email: [
          "This email is already registered to another trainer/account. Please use a different email address.",
        ],
      },
      submittedValues,
    };
  }

  // Everything remaining here matched on phone only — email duplicates
  // already returned above — so this is the normal warn-and-override flow.
  const duplicatesForState =
    duplicateMatches.length > 0
      ? duplicateMatches.map((match) => ({
          trainerId: match.candidate.id,
          name: `${match.candidate.firstName} ${match.candidate.lastName}`,
          reasons: match.reasons,
          reasonLabels: match.reasons.map((r) => TRAINER_DUPLICATE_REASON_LABELS[r]),
        }))
      : undefined;

  const submittedOverride = {
    confirmOverride,
    overrideReason: typeof overrideReasonRaw === "string" ? overrideReasonRaw : "",
  };

  if (!confirmOverride) {
    if (duplicatesForState) {
      return { duplicates: duplicatesForState, submittedValues, submittedOverride };
    }
  } else {
    const overrideParsed = duplicateOverrideSchema.safeParse({
      reason: overrideReasonRaw,
    });
    if (!overrideParsed.success) {
      return {
        fieldErrors: {
          overrideReason: overrideParsed.error.flatten().fieldErrors.reason,
        },
        duplicates: duplicatesForState,
        submittedValues,
        submittedOverride,
      };
    }
  }

  const created = await createTrainerRecord(parsed.data);
  if (!created.ok) {
    return { formError: created.error, submittedValues };
  }

  await writeAuditLog({
    actorAuthUserId: ctx.authUserId,
    actorRole: ctx.role,
    action: "trainer.create",
    entityType: "trainer",
    entityId: created.data.id,
  });

  if (confirmOverride) {
    await writeAuditLog({
      actorAuthUserId: ctx.authUserId,
      actorRole: ctx.role,
      action: "trainer.duplicate_override_confirmed",
      entityType: "trainer",
      entityId: created.data.id,
      after: {
        reason: (formData.get("overrideReason") as string).trim(),
        matchedRules: Array.from(new Set(duplicateMatches.flatMap((m) => m.reasons))),
      },
    });
  }

  redirect(`/admin/trainers/${created.data.id}`);
}

export async function updateTrainerAction(
  trainerId: string,
  _prevState: TrainerFormState,
  formData: FormData,
): Promise<TrainerFormState> {
  const ctx = await getCurrentUserContext();
  if (!ctx || !isAdminOrSuperAdmin(ctx.role)) {
    return { formError: NOT_AUTHORIZED };
  }

  const submittedValues = submittedValuesFromFormData(formData);

  const parsed = trainerProfileSchema.safeParse(profileInputFromFormData(formData));
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors, submittedValues };
  }

  const before = await getTrainerProfile(trainerId);
  const result = await updateTrainerProfile(trainerId, parsed.data);
  if (!result.ok) {
    return { formError: result.error, submittedValues };
  }

  const changedFields = before.ok
    ? Object.entries({
        firstName: parsed.data.firstName,
        lastName: parsed.data.lastName,
        email: parsed.data.email,
        phone: parsed.data.phone,
        bio: parsed.data.bio ?? null,
        specialization: parsed.data.specialization.join(","),
      })
        .filter(([key, value]) => {
          const beforeValue = (before.data as unknown as Record<string, unknown>)[key];
          const comparable =
            key === "specialization" && Array.isArray(beforeValue)
              ? beforeValue.join(",")
              : beforeValue;
          return comparable !== value;
        })
        .map(([key]) => key)
    : [];

  await writeAuditLog({
    actorAuthUserId: ctx.authUserId,
    actorRole: ctx.role,
    action: "trainer.update",
    entityType: "trainer",
    entityId: trainerId,
    after: { changedFields },
  });

  redirect(`/admin/trainers/${trainerId}`);
}

export async function setTrainerStatusAction(
  trainerId: string,
  _prevState: TrainerFormState,
  formData: FormData,
): Promise<TrainerFormState> {
  const ctx = await getCurrentUserContext();
  if (!ctx || !isAdminOrSuperAdmin(ctx.role)) {
    return { formError: NOT_AUTHORIZED };
  }

  const parsed = trainerStatusSchema.safeParse({ status: formData.get("status") });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const before = await getTrainerProfile(trainerId);
  const result = await updateTrainerStatus(trainerId, parsed.data.status);
  if (!result.ok) {
    return { formError: result.error };
  }

  await writeAuditLog({
    actorAuthUserId: ctx.authUserId,
    actorRole: ctx.role,
    action: "trainer.status_change",
    entityType: "trainer",
    entityId: trainerId,
    before: before.ok ? { status: before.data.status } : null,
    after: { status: parsed.data.status },
  });

  revalidatePath(`/admin/trainers/${trainerId}`);
  return { success: true };
}
