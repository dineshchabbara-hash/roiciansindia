"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUserContext } from "@/lib/auth/session";
import { writeAuditLog } from "@/lib/data/audit-log";
import {
  MAX_PROFILE_PHOTO_BYTES,
  MAX_PROFILE_PHOTO_LABEL,
  removeOwnProfilePhoto,
  replaceOwnProfilePhoto,
} from "@/lib/data/profile-photos";
import { checkImageUpload } from "@/lib/domain/images";

/**
 * Phase 21C — FR-41: a Student changes their own profile photo. The
 * student id always comes from the session, never from the form.
 */

export type PhotoFormState = { formError?: string; message?: string };

const NOT_AUTHORIZED = "Only a signed-in student can change their own photo.";

export async function uploadOwnProfilePhotoAction(
  _prev: PhotoFormState,
  formData: FormData,
): Promise<PhotoFormState> {
  const ctx = await getCurrentUserContext();
  if (!ctx || ctx.role !== "student" || !ctx.profileId)
    return { formError: NOT_AUTHORIZED };

  const file = formData.get("photo");
  if (!(file instanceof File) || file.size === 0)
    return { formError: "Choose a photo to upload." };
  if (file.size > MAX_PROFILE_PHOTO_BYTES) {
    return {
      formError: `The image is too large. Maximum size is ${MAX_PROFILE_PHOTO_LABEL}.`,
    };
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = checkImageUpload(bytes, MAX_PROFILE_PHOTO_BYTES, MAX_PROFILE_PHOTO_LABEL);
  if (!check.ok) return { formError: check.error };

  const stored = await replaceOwnProfilePhoto(
    ctx.profileId,
    bytes,
    check.extension,
    check.contentType,
  );
  if (!stored.ok) return { formError: stored.error };

  await writeAuditLog({
    actorAuthUserId: ctx.authUserId,
    actorRole: ctx.role,
    action: "student.profile_photo_updated",
    entityType: "student",
    entityId: ctx.profileId,
    after: { replacedPrevious: stored.data.previousPath !== null },
  });
  revalidatePath("/student/profile");
  return { message: "Photo updated." };
}

export async function removeOwnProfilePhotoAction(
  _prev: PhotoFormState,
  _formData: FormData,
): Promise<PhotoFormState> {
  void _formData;
  const ctx = await getCurrentUserContext();
  if (!ctx || ctx.role !== "student" || !ctx.profileId)
    return { formError: NOT_AUTHORIZED };

  const removed = await removeOwnProfilePhoto(ctx.profileId);
  if (!removed.ok) return { formError: removed.error };
  if (!removed.data.previousPath) return { message: "There is no photo to remove." };

  await writeAuditLog({
    actorAuthUserId: ctx.authUserId,
    actorRole: ctx.role,
    action: "student.profile_photo_removed",
    entityType: "student",
    entityId: ctx.profileId,
  });
  revalidatePath("/student/profile");
  return { message: "Photo removed." };
}
