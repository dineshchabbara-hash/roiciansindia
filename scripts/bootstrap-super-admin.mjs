// One-time, human-run bootstrap for the FIRST Super Admin account.
//
// This is deliberately a script, not a UI flow (USER_ROLES_AND_PERMISSIONS.md
// §6): there is no public signup for Super Admin, and no Admin exists yet to
// invite one, so the very first account has to be created directly against
// the database via the service-role key. Every subsequent Admin/Trainer
// account is created through the (future) Admin Portal invite flow, not
// this script.
//
// SAFETY:
//  - No password is ever hard-coded, defaulted, or read from an env var —
//    it is generated fresh by this script and printed exactly once.
//  - Refuses to run if a super_admin already exists, unless --force is
//    passed, to prevent accidentally minting a second one.
//  - Requires an explicit --email (or SUPER_ADMIN_EMAIL env var) — there is
//    no default address.
//
// Usage:
//   SUPABASE_SERVICE_ROLE_KEY=... NEXT_PUBLIC_SUPABASE_URL=... \
//     node scripts/bootstrap-super-admin.mjs --email you@yourcompany.com
//
// After running: log in at /login/admin with the printed email/password,
// then immediately use "Forgot password" to set your own password — this
// script's generated password is meant to be used exactly once.

import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";

function parseArgs(argv) {
  const args = { force: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--email") args.email = argv[++i];
    else if (argv[i] === "--first-name") args.firstName = argv[++i];
    else if (argv[i] === "--last-name") args.lastName = argv[++i];
    else if (argv[i] === "--force") args.force = true;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const email = args.email ?? process.env.SUPER_ADMIN_EMAIL;
const firstName = args.firstName ?? "Super";
const lastName = args.lastName ?? "Admin";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Set both " +
      "before running this script — see README.md.",
  );
  process.exit(1);
}

if (!email) {
  console.error(
    "Missing Super Admin email. Pass --email you@yourcompany.com or set " +
      "SUPER_ADMIN_EMAIL. There is no default — this must be a real address " +
      "you control.",
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function generatePassword() {
  return randomBytes(18).toString("base64url");
}

async function main() {
  const { data: existingSuperAdmins, error: checkError } = await supabase
    .from("user_roles")
    .select("id")
    .eq("role", "super_admin");

  if (checkError) {
    console.error("Could not check for an existing Super Admin:", checkError.message);
    process.exit(1);
  }

  if (existingSuperAdmins.length > 0 && !args.force) {
    console.error(
      `Refusing to proceed: ${existingSuperAdmins.length} Super Admin account(s) ` +
        "already exist. Pass --force if you deliberately want to add another " +
        "one (e.g. a second Super Admin for redundancy) — this will NOT touch " +
        "the existing account(s).",
    );
    process.exit(1);
  }

  const password = generatePassword();
  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (createError || !created.user) {
    console.error("Failed to create the auth user:", createError?.message);
    process.exit(1);
  }

  const authUserId = created.user.id;

  const { error: roleError } = await supabase
    .from("user_roles")
    .insert({ auth_user_id: authUserId, role: "super_admin" });

  if (roleError) {
    console.error(
      "Auth user was created but assigning the super_admin role failed:",
      roleError.message,
      `\nThe auth user (id: ${authUserId}, email: ${email}) now exists without a role — ` +
        "resolve this manually before retrying (e.g. delete the orphaned auth " +
        "user in the Supabase dashboard, or insert the user_roles row by hand).",
    );
    process.exit(1);
  }

  const { error: profileError } = await supabase.from("admins").insert({
    auth_user_id: authUserId,
    first_name: firstName,
    last_name: lastName,
    email,
    role_level: "super_admin",
  });

  if (profileError) {
    console.error(
      "Role was assigned but creating the admin profile row failed:",
      profileError.message,
    );
    process.exit(1);
  }

  console.log("\nSuper Admin account created:\n");
  console.log(`  Email:    ${email}`);
  console.log(`  Password: ${password}`);
  console.log(
    "\nThis password is shown ONCE and is not stored anywhere by this script. " +
      'Log in now at /login/admin, then immediately use "Forgot password" to ' +
      "set a password only you know.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
