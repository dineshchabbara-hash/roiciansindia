import { getCurrentUserContext } from "@/lib/auth/session";
import { isAdminOrSuperAdmin } from "@/lib/domain/rbac";
import { readProfilePhoto } from "@/lib/data/profile-photos";

/**
 * GET /api/students/[id]/photo — Phase 21C (FR-41) profile photo.
 *
 * The student themselves and Admin / Super Admin only. The photo is read
 * through the viewer's own session (students + private `profile-photos`
 * storage RLS), so another student's id is answered exactly like an
 * unknown one (404); Trainers get 403. The storage path never reaches the
 * browser and the response is private and not cached.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function textResponse(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const user = await getCurrentUserContext();
  if (!user) return textResponse(401, "Sign in to view photos.");
  if (!isAdminOrSuperAdmin(user.role) && user.role !== "student") {
    return textResponse(403, "You do not have permission to view student photos.");
  }

  const { id } = await params;
  if (!UUID_PATTERN.test(id)) return textResponse(404, "Photo not found.");
  if (user.role === "student" && user.profileId !== id) {
    return textResponse(404, "Photo not found.");
  }

  const photo = await readProfilePhoto(id);
  if (!photo) return textResponse(404, "Photo not found.");

  return new Response(Buffer.from(photo.bytes), {
    status: 200,
    headers: {
      "Content-Type": photo.contentType,
      "Content-Length": String(photo.bytes.length),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
    },
  });
}
