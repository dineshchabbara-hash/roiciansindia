import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { DataResult } from "@/lib/data/dashboard";
import {
  sniffImageType,
  IMAGE_CONTENT_TYPES,
  type ImageExtension,
} from "@/lib/domain/images";

/**
 * Phase 21C — FR-41 student profile photo.
 *
 * Objects live in the private `profile-photos` bucket at
 * {student_id}/{uuid}.{ext}. The student's own session sets
 * students.profile_photo_path (students_update_own + the self-edit trigger
 * allow it; the migration 39 check constraint keeps it inside their own
 * folder); the bytes are written with the service role, because the bucket
 * has no end-user write policy. Reads go through the viewer's own session,
 * so storage RLS decides: the student themselves and Admins only.
 */

export const PROFILE_PHOTOS_BUCKET = "profile-photos";
export const MAX_PROFILE_PHOTO_BYTES = 2 * 1024 * 1024;
export const MAX_PROFILE_PHOTO_LABEL = "2 MB";

function log(message: string, error?: unknown) {
  console.error(`[profile-photos] ${message}:`, error);
}

/** Stores a new photo for the signed-in student and removes the old one. */
export async function replaceOwnProfilePhoto(
  studentId: string,
  bytes: Uint8Array,
  extension: ImageExtension,
  contentType: string,
): Promise<DataResult<{ path: string; previousPath: string | null }>> {
  const admin = createSupabaseAdminClient();
  const path = `${studentId}/${randomUUID()}.${extension}`;
  try {
    const supabase = await createSupabaseServerClient();
    const { data: current, error: readError } = await supabase
      .from("students")
      .select("id, profile_photo_path")
      .eq("id", studentId)
      .maybeSingle();
    if (readError) throw readError;
    if (!current) return { ok: false, error: "Profile not found." };

    const { error: uploadError } = await admin.storage
      .from(PROFILE_PHOTOS_BUCKET)
      .upload(path, bytes, { contentType, upsert: false });
    if (uploadError) throw uploadError;

    const { data, error } = await supabase
      .from("students")
      .update({ profile_photo_path: path })
      .eq("id", studentId)
      .select("id");
    if (error || !data?.length) {
      await admin.storage.from(PROFILE_PHOTOS_BUCKET).remove([path]);
      if (error) throw error;
      return { ok: false, error: "You can only change your own photo." };
    }

    const previousPath = (current as { profile_photo_path: string | null })
      .profile_photo_path;
    if (previousPath && previousPath.startsWith(`${studentId}/`)) {
      const { error: removeError } = await admin.storage
        .from(PROFILE_PHOTOS_BUCKET)
        .remove([previousPath]);
      if (removeError) log("Could not remove the previous photo object", removeError);
    }
    return { ok: true, data: { path, previousPath } };
  } catch (error) {
    log("Could not store the profile photo", error);
    return { ok: false, error: "Could not upload the photo. Please try again." };
  }
}

/** Removes the signed-in student's photo (row first, then the object). */
export async function removeOwnProfilePhoto(
  studentId: string,
): Promise<DataResult<{ previousPath: string | null }>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: current, error: readError } = await supabase
      .from("students")
      .select("id, profile_photo_path")
      .eq("id", studentId)
      .maybeSingle();
    if (readError) throw readError;
    if (!current) return { ok: false, error: "Profile not found." };
    const previousPath = (current as { profile_photo_path: string | null })
      .profile_photo_path;
    if (!previousPath) return { ok: true, data: { previousPath: null } };

    const { data, error } = await supabase
      .from("students")
      .update({ profile_photo_path: null })
      .eq("id", studentId)
      .select("id");
    if (error) throw error;
    if (!data?.length) return { ok: false, error: "You can only change your own photo." };

    if (previousPath.startsWith(`${studentId}/`)) {
      const { error: removeError } = await createSupabaseAdminClient()
        .storage.from(PROFILE_PHOTOS_BUCKET)
        .remove([previousPath]);
      if (removeError) log("Could not remove the photo object", removeError);
    }
    return { ok: true, data: { previousPath } };
  } catch (error) {
    log("Could not remove the profile photo", error);
    return { ok: false, error: "Could not remove the photo. Please try again." };
  }
}

/**
 * A student's photo as the viewer's RLS allows (owner or Admin), or null
 * when there is none or the viewer may not see it.
 */
export async function readProfilePhoto(
  studentId: string,
): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: student, error } = await supabase
      .from("students")
      .select("id, profile_photo_path")
      .eq("id", studentId)
      .maybeSingle();
    if (error || !student) return null;
    const path = (student as { profile_photo_path: string | null }).profile_photo_path;
    if (!path || !path.startsWith(`${studentId}/`)) return null;

    const { data: blob, error: downloadError } = await supabase.storage
      .from(PROFILE_PHOTOS_BUCKET)
      .download(path);
    if (downloadError || !blob) return null;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const type = sniffImageType(bytes);
    if (!type) return null;
    return { bytes, contentType: IMAGE_CONTENT_TYPES[type] };
  } catch (error) {
    log("Could not read a profile photo", error);
    return null;
  }
}

/** Whether the student has a photo (for showing the image or a placeholder). */
export async function hasProfilePhoto(studentId: string): Promise<boolean> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase
      .from("students")
      .select("profile_photo_path")
      .eq("id", studentId)
      .maybeSingle();
    return Boolean(
      (data as { profile_photo_path: string | null } | null)?.profile_photo_path,
    );
  } catch {
    return false;
  }
}

/**
 * A short opaque version for the student's current photo (changes when the
 * photo changes), so the page can bust the browser's cached image without
 * ever sending the storage path. Null when there is no photo.
 */
export async function getProfilePhotoVersion(studentId: string): Promise<string | null> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase
      .from("students")
      .select("profile_photo_path")
      .eq("id", studentId)
      .maybeSingle();
    const path = (data as { profile_photo_path: string | null } | null)
      ?.profile_photo_path;
    return path ? createHash("sha256").update(path).digest("hex").slice(0, 12) : null;
  } catch {
    return null;
  }
}
