// Staging-only: creates four fictional test logins (Super Admin, Admin,
// Trainer, Student) in the SEPARATE staging Supabase project. Fails closed:
// it refuses to write unless every check in staging-guard.mjs passes AND the
// project is empty apart from its own accounts (so DEV and production, which
// hold real records, can never be seeded even if a value is mistyped).
//
// Run on your own computer; secrets stay in your terminal:
//
//   export ROICIANS_TARGET=staging
//   export STAGING_PROJECT_REF=<staging ref>
//   export PROTECTED_PROJECT_REFS=<dev ref>,<production ref>
//   export NEXT_PUBLIC_SUPABASE_URL=https://<staging ref>.supabase.co
//   export SUPABASE_SERVICE_ROLE_KEY=<staging service-role key>
//   node scripts/staging/seed-staging-users.mjs --confirm <staging ref> --dry-run
//   node scripts/staging/seed-staging-users.mjs --confirm <staging ref>
//
// --dry-run performs every check and writes nothing. Passwords are generated
// fresh, printed once on your screen and stored nowhere. Re-running leaves
// existing seed accounts (and their passwords) unchanged.

import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import {
  SEED_EMAIL_DOMAIN,
  isSeedEmail,
  stagingTargetProblems,
} from "./staging-guard.mjs";

const args = process.argv.slice(2);
const argValue = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const dryRun = args.includes("--dry-run");

function refuse(lines) {
  console.error("\nREFUSED: nothing was written.\n");
  for (const line of lines) console.error(`  - ${line}`);
  console.error("");
  process.exit(1);
}

const problems = stagingTargetProblems({
  target: process.env.ROICIANS_TARGET,
  url: process.env.NEXT_PUBLIC_SUPABASE_URL,
  stagingRef: process.env.STAGING_PROJECT_REF,
  confirmRef: argValue("--confirm"),
  protectedRefs: process.env.PROTECTED_PROJECT_REFS,
  serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
});
if (problems.length > 0) refuse(problems);

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const ACCOUNTS = [
  {
    key: "superAdmin",
    role: "super_admin",
    label: "Super Admin",
    first: "Staging",
    last: "Super Admin",
  },
  { key: "admin", role: "admin", label: "Admin", first: "Staging", last: "Admin" },
  {
    key: "trainer",
    role: "trainer",
    label: "Trainer",
    first: "Staging",
    last: "Trainer",
  },
  {
    key: "student",
    role: "student",
    label: "Student",
    first: "Staging",
    last: "Student",
  },
].map((a) => ({ ...a, email: `${a.key.toLowerCase()}@${SEED_EMAIL_DOMAIN}` }));

async function listAllAuthUsers() {
  const users = [];
  for (let page = 1; ; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`Could not list logins: ${error.message}`);
    users.push(...data.users);
    if (data.users.length < 1000) return users;
  }
}

async function liveChecks() {
  const found = [];
  // Migrations 1-42 present (website tables are migration 40).
  for (const table of ["company_settings", "website_documents"]) {
    const { error } = await supabase
      .from(table)
      .select("*", { head: true, count: "exact" });
    if (error)
      found.push(
        `Table ${table} is missing; apply migrations 1-42 first (${error.message}).`,
      );
  }
  if (found.length) return found;

  // Empty project: no business records at all.
  for (const table of ["programs", "batches", "enrollments", "payments"]) {
    const { count, error } = await supabase
      .from(table)
      .select("*", { head: true, count: "exact" });
    if (error) found.push(`Could not read ${table}: ${error.message}`);
    else if (count > 0)
      found.push(
        `${table} already holds ${count} record(s). Staging seeding only runs on a new, empty staging project.`,
      );
  }
  // People: only this seeder's own fictional accounts.
  for (const table of ["admins", "trainers", "students"]) {
    const { data, error } = await supabase.from(table).select("email");
    if (error) found.push(`Could not read ${table}: ${error.message}`);
    else {
      const others = data.filter((row) => !isSeedEmail(row.email)).length;
      if (others > 0)
        found.push(
          `${table} holds ${others} record(s) that this script did not create. Refusing.`,
        );
    }
  }
  const users = await listAllAuthUsers();
  const otherLogins = users.filter((u) => !isSeedEmail(u.email)).length;
  if (otherLogins > 0)
    found.push(
      `The project has ${otherLogins} login(s) that this script did not create. Refusing.`,
    );
  return found;
}

async function ensureLogin(account, existing) {
  const found = existing.find((u) => u.email?.toLowerCase() === account.email);
  if (found) return { id: found.id, password: null };
  const password = randomBytes(18).toString("base64url");
  const { data, error } = await supabase.auth.admin.createUser({
    email: account.email,
    password,
    email_confirm: true,
  });
  if (error || !data.user)
    throw new Error(`Could not create ${account.label} login: ${error?.message}`);
  return { id: data.user.id, password };
}

async function write(table, row, conflict) {
  const { error } = await supabase.from(table).upsert(row, { onConflict: conflict });
  if (error)
    throw new Error(
      `Could not write ${table} for ${row.email ?? row.auth_user_id}: ${error.message}`,
    );
}

async function main() {
  const live = await liveChecks();
  if (live.length > 0) refuse(live);

  if (dryRun) {
    console.log("\nDRY RUN: every check passed. This is the empty staging project.");
    console.log(
      "Would create:",
      ACCOUNTS.map((a) => `${a.label} <${a.email}>`).join(", "),
    );
    return;
  }

  const existing = await listAllAuthUsers();
  const results = [];
  for (const account of ACCOUNTS) {
    const { id, password } = await ensureLogin(account, existing);
    await write("user_roles", { auth_user_id: id, role: account.role }, "auth_user_id");
    const base = {
      auth_user_id: id,
      first_name: account.first,
      last_name: account.last,
      email: account.email,
    };
    if (account.role === "super_admin" || account.role === "admin") {
      await write(
        "admins",
        { ...base, role_level: account.role, status: "active" },
        "auth_user_id",
      );
    } else if (account.role === "trainer") {
      await write("trainers", { ...base, status: "active" }, "auth_user_id");
    } else {
      await write("students", { ...base, phone: "+919876500001" }, "auth_user_id");
    }
    results.push({ ...account, password });
  }

  console.log("\nStaging test logins (fictional; shown once, stored nowhere):\n");
  for (const r of results) {
    console.log(
      `  ${r.label.padEnd(12)} ${r.email}  ${r.password ? `password: ${r.password}` : "(already existed; password unchanged)"}`,
    );
  }
  console.log(
    "\nSign in at /login/admin, /login/trainer and /login/student on the staging site.",
  );
}

main().catch((error) => {
  console.error(`\nSTOPPED: ${error.message}`);
  process.exit(1);
});
