import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({ getCurrentUserContext: vi.fn() }));
vi.mock("@/lib/data/profile-photos", () => ({
  MAX_PROFILE_PHOTO_BYTES: 2 * 1024 * 1024,
  MAX_PROFILE_PHOTO_LABEL: "2 MB",
  replaceOwnProfilePhoto: vi.fn(),
  removeOwnProfilePhoto: vi.fn(),
}));
vi.mock("@/lib/data/audit-log", () => ({ writeAuditLog: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
  removeOwnProfilePhotoAction,
  uploadOwnProfilePhotoAction,
} from "@/lib/actions/profile-photos";
import { getCurrentUserContext } from "@/lib/auth/session";
import { removeOwnProfilePhoto, replaceOwnProfilePhoto } from "@/lib/data/profile-photos";
import { writeAuditLog } from "@/lib/data/audit-log";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

function context(role: "admin" | "super_admin" | "trainer" | "student") {
  return {
    authUserId: `${role}-auth-1`,
    email: null,
    role,
    profileId: `${role}-profile-1`,
    displayName: null,
  };
}

function photoForm(bytes: Uint8Array | string, extra: Record<string, string> = {}) {
  const fd = new FormData();
  fd.set("photo", new File([bytes as BlobPart], "me.jpg"));
  for (const [k, v] of Object.entries(extra)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("uploadOwnProfilePhotoAction", () => {
  it.each(["admin", "super_admin", "trainer"] as const)("refuses a %s", async (role) => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(context(role));
    expect(
      (await uploadOwnProfilePhotoAction({}, photoForm(JPEG))).formError,
    ).toBeTruthy();
    expect(replaceOwnProfilePhoto).not.toHaveBeenCalled();
  });

  it("always uses the session's student id, never one from the form", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(context("student"));
    vi.mocked(replaceOwnProfilePhoto).mockResolvedValue({
      ok: true,
      data: { path: "student-profile-1/x.jpg", previousPath: null },
    });
    const state = await uploadOwnProfilePhotoAction(
      {},
      photoForm(JPEG, { studentId: "someone-else" }),
    );
    expect(state.message).toBe("Photo updated.");
    expect(replaceOwnProfilePhoto).toHaveBeenCalledWith(
      "student-profile-1",
      expect.any(Uint8Array),
      "jpg",
      "image/jpeg",
    );
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "student.profile_photo_updated",
        entityId: "student-profile-1",
      }),
    );
  });

  it("rejects a non-image by its bytes", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(context("student"));
    const state = await uploadOwnProfilePhotoAction(
      {},
      photoForm("<html>not an image</html>"),
    );
    expect(state.formError).toBe("Upload a PNG, JPEG or WebP image.");
    expect(replaceOwnProfilePhoto).not.toHaveBeenCalled();
  });
});

describe("removeOwnProfilePhotoAction", () => {
  it("removes the signed-in student's photo and audits it", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(context("student"));
    vi.mocked(removeOwnProfilePhoto).mockResolvedValue({
      ok: true,
      data: { previousPath: "student-profile-1/x.jpg" },
    });
    expect((await removeOwnProfilePhotoAction({}, new FormData())).message).toBe(
      "Photo removed.",
    );
    expect(removeOwnProfilePhoto).toHaveBeenCalledWith("student-profile-1");
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "student.profile_photo_removed" }),
    );
  });
});
