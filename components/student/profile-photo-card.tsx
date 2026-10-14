"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  removeOwnProfilePhotoAction,
  uploadOwnProfilePhotoAction,
  type PhotoFormState,
} from "@/lib/actions/profile-photos";
import { ACCEPTED_IMAGE_INPUT } from "@/lib/domain/images";

const initialState: PhotoFormState = {};

/**
 * Phase 21C — FR-41: the Student uploads or removes their own profile
 * photo. The image is served from a private, session-checked route
 * (`version` busts the browser's in-page copy after a change).
 */
export function ProfilePhotoCard({
  studentId,
  hasPhoto,
  version,
  maxLabel,
}: {
  studentId: string;
  hasPhoto: boolean;
  version: string;
  maxLabel: string;
}) {
  const [uploadState, uploadAction, uploading] = useActionState(
    uploadOwnProfilePhotoAction,
    initialState,
  );
  const [removeState, removeAction, removing] = useActionState(
    removeOwnProfilePhotoAction,
    initialState,
  );
  const error = uploadState.formError ?? removeState.formError;
  const message = uploadState.message ?? removeState.message;

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
      {hasPhoto ? (
        // eslint-disable-next-line @next/next/no-img-element -- private, session-authorized route
        <img
          src={`/api/students/${studentId}/photo?v=${encodeURIComponent(version)}`}
          alt="Your profile photo"
          className="size-24 shrink-0 rounded-full border object-cover"
        />
      ) : (
        <div
          aria-label="No profile photo"
          className="bg-muted text-muted-foreground flex size-24 shrink-0 items-center justify-center rounded-full text-xs"
        >
          No photo
        </div>
      )}
      <div className="flex flex-col gap-3">
        <form
          action={uploadAction}
          aria-label="Upload profile photo"
          className="flex flex-col gap-2"
        >
          <Label htmlFor="profile-photo">Profile photo</Label>
          <input
            id="profile-photo"
            name="photo"
            type="file"
            accept={ACCEPTED_IMAGE_INPUT}
            required
            className="text-sm"
            aria-describedby="profile-photo-hint"
          />
          <p id="profile-photo-hint" className="text-muted-foreground text-xs">
            PNG, JPEG or WebP, up to {maxLabel}. Visible to you and the institute&apos;s
            administrators only.
          </p>
          <div>
            <Button type="submit" size="sm" disabled={uploading}>
              {uploading ? "Uploading..." : "Upload photo"}
            </Button>
          </div>
        </form>
        {hasPhoto && (
          <form action={removeAction} aria-label="Remove profile photo">
            <Button type="submit" size="sm" variant="outline" disabled={removing}>
              {removing ? "Removing..." : "Remove photo"}
            </Button>
          </form>
        )}
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        {message && !error && (
          <p role="status" className="text-sm text-green-700 dark:text-green-400">
            {message}
          </p>
        )}
      </div>
    </div>
  );
}
