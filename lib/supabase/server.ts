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
          } catch (error) {
            // TEMP-DIAGNOSTIC(phase5-e2e): opt-in only (PHASE5_E2E_DEBUG_AUTH=1),
            // never fires in normal operation — matching notes in
            // lib/auth/session.ts / lib/supabase/middleware.ts. Logs a fixed
            // message plus only the error's constructor name (e.g. "Error",
            // "TypeError") as a non-sensitive category — never the message,
            // a stack trace, or any cookie name/value. Safe to delete once
            // the root cause is confirmed from real output.
            if (process.env.PHASE5_E2E_DEBUG_AUTH === "1") {
              console.error(
                "[phase5-e2e][createSupabaseServerClient setAll] cookieStore.set threw",
                error instanceof Error ? error.constructor.name : typeof error,
              );
            }
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
