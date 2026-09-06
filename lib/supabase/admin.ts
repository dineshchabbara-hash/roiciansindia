import "server-only";

import { createClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client. Bypasses Row Level Security entirely —
 * reserved for the narrow set of operations that must run with elevated
 * privilege (Student ID assignment, payment confirmation, receipt
 * numbering, account provisioning scripts). See ARCHITECTURE.md §5/§13.
 *
 * NEVER import this module from a "use client" file or expose its output
 * to the browser. The `server-only` import above makes an accidental
 * client-bundle import fail the build rather than leak the key at runtime.
 */
export function createSupabaseAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "createSupabaseAdminClient() requires NEXT_PUBLIC_SUPABASE_URL and " +
        "SUPABASE_SERVICE_ROLE_KEY to be set. This client must never be " +
        "constructed with a missing service-role key.",
    );
  }

  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
