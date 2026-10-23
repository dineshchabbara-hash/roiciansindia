import { createClient } from "@supabase/supabase-js";
import type { MediaMimeType } from "@/lib/domain/website-media";

/**
 * Phase 22B-3, browser side: sends a file straight to the private
 * website-media bucket using the one-time signed upload link the server
 * created for exactly this path. Uses only the public project URL and anon
 * key (the link itself carries the permission); the file never passes
 * through the application server. Overwriting is not allowed.
 */
export async function uploadToSignedMediaUrl(
  path: string,
  token: string,
  file: Blob,
  type: MediaMimeType,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key)
    return { ok: false, error: "Uploading is not configured on this site." };
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const body = new Blob([file], { type });
  const { error } = await client.storage
    .from("website-media")
    .uploadToSignedUrl(path, token, body, { contentType: type, upsert: false });
  if (!error) return { ok: true };
  const message = error.message ?? "";
  if (/too large|exceed|maximum allowed size/i.test(message)) {
    return { ok: false, error: "The file is larger than 5 MB. Use a smaller image." };
  }
  if (/mime|content type|not supported/i.test(message)) {
    return { ok: false, error: "Only JPEG, PNG and WebP images can be uploaded." };
  }
  return {
    ok: false,
    error: "The upload did not finish. Check your connection and try again.",
  };
}
