// Read-only check of a deployed private staging site. Sends no data, signs in
// to nothing and needs no Supabase or Razorpay keys. Run on your computer:
//
//   export STAGING_URL=https://<staging host>
//   export STAGING_ACCESS_USER=<the gate user name>
//   export STAGING_ACCESS_PASSWORD=<the gate password>
//   node scripts/staging/verify-staging.mjs
//
// Checks: the gate refuses visitors without the password on every kind of
// path (pages, private APIs, build files, image-like paths, look-alikes of
// the webhook); pages answer with it and are marked noindex and uncacheable;
// portal pages send signed-out visitors to their login; auth redirects use
// the public address (not localhost); only the exact Razorpay webhook path is
// outside the gate, and it rejects an unsigned call.

const base = (process.env.STAGING_URL ?? "").replace(/\/+$/, "");
const user = process.env.STAGING_ACCESS_USER?.trim() ?? "";
const password = process.env.STAGING_ACCESS_PASSWORD ?? "";

let origin;
try {
  const url = new URL(base);
  const local = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if (url.protocol !== "https:" && !local) throw new Error("STAGING_URL must use https.");
  origin = url.origin;
} catch (error) {
  console.error(`Set STAGING_URL to the staging address (${error.message}).`);
  process.exit(1);
}
if (!user || !password) {
  console.error(
    "Set STAGING_ACCESS_USER and STAGING_ACCESS_PASSWORD (the staging gate credentials).",
  );
  process.exit(1);
}

const auth = (u, p) => `Basic ${Buffer.from(`${u}:${p}`, "utf8").toString("base64")}`;
const good = { authorization: auth(user, password) };
const results = [];
const check = (label, pass, detail) => results.push({ label, pass, detail });

async function get(path, headers = {}, method = "GET", body) {
  return fetch(`${base}${path}`, { method, headers, body, redirect: "manual" });
}

async function main() {
  let res = await get("/");
  check(
    "Gate refuses a visitor without the password",
    res.status === 401 && /^Basic/i.test(res.headers.get("www-authenticate") ?? ""),
    `HTTP ${res.status}`,
  );
  res = await get("/login/admin", { authorization: auth(user, `${password}-wrong`) });
  check("Gate refuses a wrong password", res.status === 401, `HTTP ${res.status}`);

  // A real build file, found through the login page.
  const page = await (await get("/login/admin", good)).text();
  const chunk =
    page.match(/\/_next\/static\/[^"'\s]+\.js/)?.[0] ?? "/_next/static/missing.js";
  for (const path of [
    chunk,
    "/_next/image?url=%2Ffavicon.ico&w=64&q=75",
    "/favicon.ico",
    "/admin/students/example.png",
    "/student/enrollments/example.jpg",
    "/api/students/00000000-0000-0000-0000-000000000000/photo",
    "/api/payments/00000000-0000-0000-0000-000000000000/receipt",
    "/api/exports/payments",
    "/api/razorpay/webhook/extra",
    "/api/razorpay/webhooks",
  ]) {
    res = await get(path);
    check(
      `Gate covers ${path.length > 48 ? `${path.slice(0, 45)}...` : path}`,
      res.status === 401,
      `HTTP ${res.status}`,
    );
  }
  res = await get(chunk, good);
  check(
    "Build files load with the password and are not cacheable",
    res.status === 200 && /no-store/.test(res.headers.get("cache-control") ?? ""),
    `HTTP ${res.status}; cache-control: ${res.headers.get("cache-control")}`,
  );

  for (const path of [
    "/",
    "/login/admin",
    "/login/trainer",
    "/login/student",
    "/verify-certificate",
  ]) {
    res = await get(path, good);
    const robots = res.headers.get("x-robots-tag") ?? "";
    const cache = res.headers.get("cache-control") ?? "";
    check(
      `${path} opens with the password, noindex and uncacheable`,
      res.status === 200 && /noindex/.test(robots) && /no-store/.test(cache),
      `HTTP ${res.status}; x-robots-tag: ${robots || "missing"}; cache-control: ${cache || "missing"}`,
    );
  }

  for (const [path, login] of [
    ["/admin", "/login/admin"],
    ["/trainer", "/login/trainer"],
    ["/student", "/login/student"],
  ]) {
    res = await get(path, good);
    const location = res.headers.get("location") ?? "";
    check(
      `${path} sends a signed-out visitor to ${login}`,
      res.status >= 300 && res.status < 400 && new URL(location, base).pathname === login,
      `HTTP ${res.status} → ${location}`,
    );
  }

  for (const path of ["/auth/callback", "/auth/confirm"]) {
    res = await get(path, good);
    const location = res.headers.get("location") ?? "";
    let target = "";
    try {
      target = new URL(location, base).origin;
    } catch {
      target = "";
    }
    check(`${path} redirects to the public address`, target === origin, `→ ${location}`);
  }

  res = await get(
    "/api/razorpay/webhook",
    { "content-type": "application/json" },
    "POST",
    "{}",
  );
  check(
    "Exact Razorpay webhook path is outside the gate and rejects an unsigned call",
    res.status === 400,
    res.status === 503
      ? "HTTP 503: RAZORPAY_WEBHOOK_SECRET is not set"
      : `HTTP ${res.status}`,
  );

  const width = Math.max(...results.map((r) => r.label.length));
  for (const r of results)
    console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.label.padEnd(width)}  ${r.detail}`);
  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(`Could not reach ${base}: ${error.message}`);
  process.exit(1);
});
