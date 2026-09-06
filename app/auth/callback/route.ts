import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Allow-list of internal redirect targets — `next` comes from a query
// param on a URL we ourselves generated (resetPasswordForEmail's
// redirectTo), but it still passes through the browser/email client, so it
// is validated against a fixed list rather than trusted outright. This is
// the only sanctioned use of a dynamic post-auth redirect in Phase 3.
const ALLOWED_NEXT_PATHS = new Set(["/reset-password"]);

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const rawNext = searchParams.get("next") ?? "/";
  const next = ALLOWED_NEXT_PATHS.has(rawNext) ? rawNext : "/";

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
}
