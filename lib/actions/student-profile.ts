"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUserContext } from "@/lib/auth/session";
import { getMyStudentProfile, updateMyStudentProfile } from "@/lib/data/student-portal";
import { writeAuditLog } from "@/lib/data/audit-log";
import { studentSelfProfileSchema } from "@/lib/validation/student-self-profile";

const NOT_AUTHORIZED = "You are not authorized to perform this action.";

export type SubmittedStudentSelfProfileValues = {
  phoneCountry: string;
  phone: string;
  alternatePhone: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
};

export type StudentSelfProfileFormState = {
  formError?: string;
  fieldErrors?: Partial<Record<string, string[]>>;
  success?: boolean;
  // Same React-19-resets-uncontrolled-fields reason as
  // lib/actions/students.ts's StudentFormState.submittedValues.
  submittedValues?: SubmittedStudentSelfProfileValues;
};

function profileInputFromFormData(formData: FormData) {
  return {
    phoneCountry: formData.get("phoneCountry"),
    phone: formData.get("phone"),
    alternatePhone: formData.get("alternatePhone"),
    addressLine1: formData.get("addressLine1"),
    addressLine2: formData.get("addressLine2"),
    city: formData.get("city"),
    state: formData.get("state"),
    postalCode: formData.get("postalCode"),
  };
}

function submittedValuesFromFormData(
  formData: FormData,
): SubmittedStudentSelfProfileValues {
  const asString = (value: FormDataEntryValue | null) =>
    typeof value === "string" ? value : "";
  return {
    phoneCountry: asString(formData.get("phoneCountry")),
    phone: asString(formData.get("phone")),
    alternatePhone: asString(formData.get("alternatePhone")),
    addressLine1: asString(formData.get("addressLine1")),
    addressLine2: asString(formData.get("addressLine2")),
    city: asString(formData.get("city")),
    state: asString(formData.get("state")),
    postalCode: asString(formData.get("postalCode")),
  };
}

// Deliberately re-checks the role here even though app/student/layout.tsx
// already gates the whole route group — a Server Action is its own
// trust boundary (SECURITY_PLAN.md §4) and must never assume it can only be
// reached through that layout.
export async function updateMyProfileAction(
  _prevState: StudentSelfProfileFormState,
  formData: FormData,
): Promise<StudentSelfProfileFormState> {
  const ctx = await getCurrentUserContext();
  if (!ctx || ctx.role !== "student") {
    return { formError: NOT_AUTHORIZED };
  }

  const submittedValues = submittedValuesFromFormData(formData);

  const parsed = studentSelfProfileSchema.safeParse(profileInputFromFormData(formData));
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors, submittedValues };
  }

  const before = await getMyStudentProfile();
  const result = await updateMyStudentProfile(parsed.data);
  if (!result.ok) {
    return { formError: result.error, submittedValues };
  }

  // Minimal metadata only (which fields changed, not their values) — same
  // convention as lib/actions/enrollments.ts's own audit calls.
  const changedFields = before.ok
    ? Object.entries({
        phone: parsed.data.phone,
        alternatePhone: parsed.data.alternatePhone ?? null,
        addressLine1: parsed.data.addressLine1 ?? null,
        addressLine2: parsed.data.addressLine2 ?? null,
        city: parsed.data.city ?? null,
        state: parsed.data.state ?? null,
        postalCode: parsed.data.postalCode ?? null,
      })
        .filter(([key, value]) => (before.data as Record<string, unknown>)[key] !== value)
        .map(([key]) => key)
    : [];

  if (ctx.profileId) {
    await writeAuditLog({
      actorAuthUserId: ctx.authUserId,
      actorRole: ctx.role,
      action: "student.self_update",
      entityType: "student",
      entityId: ctx.profileId,
      after: { changedFields },
    });
  }

  revalidatePath("/student/profile");
  return { success: true };
}
