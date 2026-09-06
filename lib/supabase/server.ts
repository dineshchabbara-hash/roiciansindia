import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Supabase client for Server Components, Server Actions, and Route Handlers.
 * Uses the anon key and the caller's own session cookie, so every query it
 * makes is subject to Row Level Security — this is the client the app uses
 * for almost everything (ARCHITECTURE.md §5).
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component that can't set cookies (no
            // active response, e.g. during static rendering). Session
            // refresh for that request is handled by middleware instead —
            // safe to ignore here.
          }
        },
      },
    },
  );
}
