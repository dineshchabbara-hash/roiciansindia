// Dev-only demo account seeding: one Super Admin, one Admin, one Trainer, and
// one Student, each with a real Supabase Auth login. Raw SQL cannot create
// Auth users correctly (password hashing/session plumbing is owned by
// Supabase Auth), so this uses the Admin API via the service-role key
// instead — see ARCHITECTURE.md §5 "Account provisioning".
//
// Usage:
//   SUPABASE_SERVICE_ROLE_KEY=... NEXT_PUBLIC_SUPABASE_URL=... \
//     node scripts/seed-demo-users.mjs
//
// Passwords are generated fresh on every run and printed once to the
// terminal — never hard-coded, never committed. Re-running is safe: existing
// demo users are detected by email and left as-is.

import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. " +
      "Copy .env.example to .env.local, fill in your local/dev Supabase " +
      "project's values, and export them before running this script.",
  );
  process.exit(1);
}

if (/\.supabase\.co$/.test(new URL(SUPABASE_URL).hostname)) {
  console.warn(
    "WARNING: this looks like a hosted Supabase project, not a local one. " +
      "Demo accounts with generated passwords should only be seeded into " +
      "local or throwaway dev/staging projects, never production.",
  );
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoSignIn: false },
});

function generatePassword() {
  return randomBytes(18).toString("base64url");
}

async function ensureAuthUser(email) {
  const { data: existing } = await supabase.auth.admin.listUsers();
  const found = existing?.users?.find((u) => u.email === email);
  if (found) {
    return { user: found, password: null };
  }

  const password = generatePassword();
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw new Error(`Failed to create auth user ${email}: ${error.message}`);
  return { user: data.user, password };
}

async function upsertRole(authUserId, role) {
  const { error } = await supabase
    .from("user_roles")
    .upsert({ auth_user_id: authUserId, role }, { onConflict: "auth_user_id" });
  if (error) throw new Error(`Failed to set role ${role}: ${error.message}`);
}

async function main() {
  const created = [];

  // Super Admin
  {
    const email = "superadmin@demo.roicianstech.local";
    const { user, password } = await ensureAuthUser(email);
    await upsertRole(user.id, "super_admin");
    await supabase.from("admins").upsert(
      {
        auth_user_id: user.id,
        first_name: "Demo",
        last_name: "Super Admin",
        email,
        role_level: "super_admin",
      },
      { onConflict: "auth_user_id" },
    );
    created.push({ role: "Super Admin", email, password });
  }

  // Admin
  {
    const email = "admin@demo.roicianstech.local";
    const { user, password } = await ensureAuthUser(email);
    await upsertRole(user.id, "admin");
    await supabase.from("admins").upsert(
      {
        auth_user_id: user.id,
        first_name: "Demo",
        last_name: "Admin",
        email,
        role_level: "admin",
      },
      { onConflict: "auth_user_id" },
    );
    created.push({ role: "Admin", email, password });
  }

  // Trainer
  {
    const email = "trainer@demo.roicianstech.local";
    const { user, password } = await ensureAuthUser(email);
    await upsertRole(user.id, "trainer");
    await supabase.from("trainers").upsert(
      {
        auth_user_id: user.id,
        first_name: "Demo",
        last_name: "Trainer",
        email,
      },
      { onConflict: "auth_user_id" },
    );
    created.push({ role: "Trainer", email, password });
  }

  // Student
  {
    const email = "student@demo.roicianstech.local";
    const { user, password } = await ensureAuthUser(email);
    await upsertRole(user.id, "student");
    await supabase.from("students").upsert(
      {
        auth_user_id: user.id,
        first_name: "Demo",
        last_name: "Student",
        email,
        phone: "+911234500000",
      },
      { onConflict: "auth_user_id" },
    );
    created.push({ role: "Student", email, password });
  }

  console.log("\nDemo accounts ready:\n");
  for (const { role, email, password } of created) {
    console.log(
      `  ${role.padEnd(12)} ${email}` +
        (password
          ? `  password: ${password}`
          : "  (already existed — password unchanged)"),
    );
  }
  console.log(
    "\nThese passwords are shown once and are not stored anywhere. Re-run " +
      "this script if you need a fresh one for an account you no longer " +
      "have the password for (it will not overwrite the auth user, only " +
      "reuse it — delete the user first in the Supabase dashboard to reset).",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
