import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Refreshes the Supabase session cookie on every request that hits
 * middleware.ts. This does NOT perform authorization (that happens in each
 * route group's layout, per ARCHITECTURE.md §5) — it only keeps the session
 * token from silently expiring while a user is active.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          supabaseResponse = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            supabaseResponse.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Failing closed on error: if Supabase is unreachable or misconfigured,
  // treat the request as unauthenticated rather than throwing and taking
  // the whole app down. Route-group layouts re-check the session anyway —
  // this call exists only to refresh the cookie, not to authorize.
  try {
    const { error } = await supabase.auth.getUser();
    // TEMP-DIAGNOSTIC(phase5-e2e): opt-in only (PHASE5_E2E_DEBUG_AUTH=1),
    // never fires in normal operation — see the matching note in
    // lib/auth/session.ts for why this was added. Logs no token values.
    if (error && process.env.PHASE5_E2E_DEBUG_AUTH === "1") {
      console.error(
        `[phase5-e2e][proxy updateSession] getUser() error for ${request.nextUrl.pathname}:`,
        error.message,
      );
    }
  } catch (error) {
    if (process.env.PHASE5_E2E_DEBUG_AUTH === "1") {
      console.error(
        `[phase5-e2e][proxy updateSession] getUser() threw for ${request.nextUrl.pathname}:`,
        error instanceof Error ? error.message : error,
      );
    }
    // Otherwise intentionally swallowed — see comment above.
  }

  return supabaseResponse;
}
