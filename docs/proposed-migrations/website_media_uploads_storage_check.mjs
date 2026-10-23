// PREPARED FOR REVIEW. Not wired into CI or any npm script.
//
// Phase 22B-3 check against the REAL Supabase Storage service (supabase/storage,
// run from source with its file backend) on a THROWAWAY local Postgres that has
// Storage's own schema, supabase/tests/auth_schema_stub.sql, migrations 1-42,
// website_media_uploads.sql and the fixture accounts of website_media_uploads_test.sql
// (inserted and committed, not rolled back). Never point it at a hosted project.
//
// Uses this repo's @supabase/storage-js: the same calls the app makes
// (createSignedUploadUrl, uploadToSignedUrl with the anon key, download,
// remove, createSignedUrls). Database functions are called as PostgREST would:
// role authenticated plus the caller's JWT claims.
//
// Settings (environment):
//   STORAGE_URL          e.g. http://127.0.0.1:5055 (the local storage-api)
//   STORAGE_JWT_SECRET   the local storage-api AUTH_JWT_SECRET (throwaway)
//   STORAGE_DB           local database name (psql as the postgres OS user)
//   STORAGE_FILE_PATH    the storage-api STORAGE_FILE_BACKEND_PATH
import crypto from "node:crypto";
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";
import { StorageClient } from "@supabase/storage-js";

for (const k of [
  "STORAGE_URL",
  "STORAGE_JWT_SECRET",
  "STORAGE_DB",
  "STORAGE_FILE_PATH",
]) {
  if (!process.env[k]) throw new Error(`Set ${k}`);
}
if (!/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(process.env.STORAGE_URL)) {
  throw new Error("STORAGE_URL must be a local storage-api");
}
const env = {
  AUTH_JWT_SECRET: process.env.STORAGE_JWT_SECRET,
  STORAGE_FILE_BACKEND_PATH: process.env.STORAGE_FILE_PATH,
};
const URL_BASE = process.env.STORAGE_URL.replace(/\/$/, "");
const BUCKET = "website-media";
const ids = {
  superAdmin: "b3000000-0000-0000-0000-000000000001",
  admin: "b3000000-0000-0000-0000-000000000002",
  admin2: "b3000000-0000-0000-0000-000000000003",
  trainer: "b3000000-0000-0000-0000-000000000004",
  student: "b3000000-0000-0000-0000-000000000005",
  inactive: "b3000000-0000-0000-0000-000000000006",
};

const b64 = (o) =>
  Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url");
function jwt(payload) {
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64({
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...payload,
  });
  const sig = crypto
    .createHmac("sha256", env.AUTH_JWT_SECRET)
    .update(`${head}.${body}`)
    .digest("base64url");
  return `${head}.${body}.${sig}`;
}
const anonKey = jwt({ role: "anon" });
const client = (sub) => {
  const token = sub ? jwt({ sub, role: "authenticated", aud: "authenticated" }) : anonKey;
  return new StorageClient(URL_BASE, {
    apikey: anonKey,
    Authorization: `Bearer ${token}`,
  }).from(BUCKET);
};

function crc32(buf) {
  let c,
    crc = 0xffffffff;
  for (const b of buf) {
    c = (crc ^ b) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function png(w, h) {
  const chunk = (t, d) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(d.length);
    const td = Buffer.concat([Buffer.from(t), d]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h, 0x7f);
  for (let y = 0; y < h; y++) raw[y * (w * 3 + 1)] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
const folder = () => crypto.randomUUID();

function sql(query) {
  return execFileSync(
    "sudo",
    [
      "-u",
      "postgres",
      "psql",
      "-d",
      process.env.STORAGE_DB,
      "-Atq",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      query,
    ],
    { encoding: "utf8" },
  ).trim();
}
// What PostgREST does for an RPC call: authenticated role + the caller's claims.
function asUser(sub, query) {
  try {
    return {
      ok: true,
      out: execFileSync(
        "sudo",
        [
          "-u",
          "postgres",
          "psql",
          "-d",
          process.env.STORAGE_DB,
          "-Atq",
          "-v",
          "ON_ERROR_STOP=1",
        ],
        {
          input: `begin; set local role authenticated; select set_config('request.jwt.claims', '{"sub":"${sub}","role":"authenticated"}', true) \\g /dev/null\n${query}\ncommit;`,
          encoding: "utf8",
          stdio: ["pipe", "pipe", "pipe"],
        },
      ).trim(),
    };
  } catch (e) {
    return { ok: false, out: String(e.stderr).trim().split("\n").pop() };
  }
}
const fileOnDisk = (path) => {
  const out = execFileSync(
    "find",
    [env.STORAGE_FILE_BACKEND_PATH, "-path", `*${BUCKET}/${path}*`],
    { encoding: "utf8" },
  ).trim();
  return out.length > 0;
};

let pass = 0,
  fail = 0;
const results = [];
function check(id, cond, label, detail = "") {
  results.push(
    `${cond ? "PASS" : "FAIL"} ${id}: ${label}${detail ? ` (${detail})` : ""}`,
  );
  if (cond) pass++;
  else fail++;
}
const msg = (e) =>
  e ? `${e.statusCode ?? e.status ?? ""} ${e.message}`.trim() : "no error";

async function signAndUpload(sub, path, bytes, type, opts = {}) {
  const signed = await client(sub).createSignedUploadUrl(
    path,
    opts.upsert ? { upsert: true } : undefined,
  );
  if (signed.error) return { signError: signed.error };
  // Browser side: anon key only; the token carries the permission.
  const up = await client(null).uploadToSignedUrl(
    path,
    signed.data.token,
    new Blob([bytes], { type }),
    { contentType: type, upsert: false },
  );
  return { token: signed.data.token, uploadError: up.error };
}
const register = (sub, path, size, w = 64, h = 48, mime = "image/png") =>
  asUser(
    sub,
    `select website_register_media_asset('${path}', '${mime}', ${size}, ${w}, ${h}, null);`,
  );

// S1 Admin: sign, upload via token, owner recorded, metadata recorded.
const img = png(64, 48);
const p1 = `${folder()}/hero.png`;
let r = await signAndUpload(ids.admin, p1, img, "image/png");
check(
  "S1a",
  !r.signError && !r.uploadError,
  "active Admin gets a signed upload link and uploads through it with the anon key",
  msg(r.signError || r.uploadError),
);
const row1 = sql(
  `select owner, owner_id, metadata->>'size', metadata->>'mimetype' from storage.objects where bucket_id='${BUCKET}' and name='${p1}'`,
);
check(
  "S1b",
  row1 === `${ids.admin}|${ids.admin}|${img.length}|image/png`,
  "Storage records owner and owner_id as the Admin who signed, and the real size and type",
  row1,
);
check("S1c", fileOnDisk(p1), "bytes stored in the private bucket");

// S2 Server reads it back (completeMediaUploadAction downloads to inspect bytes).
const dl = await client(ids.admin).download(p1);
const same = !dl.error && Buffer.from(await dl.data.arrayBuffer()).equals(img);
check(
  "S2",
  same,
  "Admin session can download the uploaded bytes for content inspection",
  msg(dl.error),
);

// S3 Register as the Admin (as PostgREST would call the RPC).
r = register(ids.admin, p1, img.length);
check(
  "S3a",
  r.ok && /^[0-9a-f-]{36}$/.test(r.out),
  "Admin registers the uploaded image",
  r.out,
);
const assetId = r.out;
check(
  "S3b",
  sql(`select status from website_media_assets where id='${assetId}'`) === "draft",
  "registered as Draft",
);
check(
  "S3c",
  Number(
    sql(
      `select count(*) from audit_logs where entity_id='${assetId}' and action='website_media_asset.registered' and actor_auth_user_id='${ids.admin}'`,
    ),
  ) >= 1,
  "registration audited",
);

// S4 No overwrite: same path again, with and without upsert.
r = await signAndUpload(ids.admin, p1, png(10, 10), "image/png");
check(
  "S4a",
  !!r.signError || !!r.uploadError,
  "upload to a registered path refused",
  msg(r.signError || r.uploadError),
);
r = await signAndUpload(ids.admin, p1, png(10, 10), "image/png", { upsert: true });
check("S4b", !!r.signError, "upsert link refused (no update policy)", msg(r.signError));
const dl2 = await client(ids.admin).download(p1);
check(
  "S4c",
  !dl2.error && Buffer.from(await dl2.data.arrayBuffer()).equals(img),
  "original bytes unchanged",
);
const mv = await client(ids.admin).move(p1, `${folder()}/moved.png`);
check("S4d", !!mv.error, "move/rename refused", msg(mv.error));

// S5 Second Admin cannot register the first Admin's unregistered upload.
const p5 = `${folder()}/mine.png`;
await signAndUpload(ids.admin, p5, img, "image/png");
r = register(ids.admin2, p5, img.length);
check("S5", !r.ok, "another Admin cannot register someone else's upload", r.out);

// S6 Remove incomplete upload (own, recent).
const rm = await client(ids.admin).remove([p5]);
check(
  "S6a",
  !rm.error && rm.data.length === 1,
  "Admin removes own incomplete upload",
  msg(rm.error),
);
check(
  "S6b",
  sql(`select count(*) from storage.objects where name='${p5}'`) === "0" &&
    !fileOnDisk(p5),
  "row and bytes gone",
);

// S7 Another Admin's recent unregistered upload: not removable until 24 h.
const p7 = `${folder()}/theirs.png`;
await signAndUpload(ids.admin2, p7, img, "image/png");
let rm7 = await client(ids.admin).remove([p7]);
check(
  "S7a",
  (rm7.data ?? []).length === 0 &&
    sql(`select count(*) from storage.objects where name='${p7}'`) === "1",
  "another Admin's recent upload is not removed",
  msg(rm7.error),
);
sql(
  `update storage.objects set created_at = now() - interval '25 hours' where name='${p7}'`,
);
const listed = asUser(
  ids.admin,
  "select storage_path from website_incomplete_media_uploads();",
);
check(
  "S7b",
  listed.ok && listed.out.split("\n").includes(p7),
  "abandoned upload listed for clean-up after 24 h",
  listed.out,
);
rm7 = await client(ids.admin).remove([p7]);
check(
  "S7c",
  (rm7.data ?? []).length === 1 && !fileOnDisk(p7),
  "abandoned upload removed by any active Admin after 24 h",
  msg(rm7.error),
);

// S8 Registered image can never be removed.
const rm8 = await client(ids.admin).remove([p1]);
check(
  "S8",
  (rm8.data ?? []).length === 0 && fileOnDisk(p1),
  "registered image cannot be removed",
  msg(rm8.error),
);

// S9 Other roles and anon cannot get an upload link.
for (const [who, sub] of [
  ["Super Admin", ids.superAdmin],
  ["Trainer", ids.trainer],
  ["Student", ids.student],
  ["inactive Admin", ids.inactive],
  ["anon", null],
]) {
  const s = await client(sub).createSignedUploadUrl(`${folder()}/x.png`);
  if (who === "Super Admin")
    check("S9-super", !s.error, "Super Admin gets an upload link", msg(s.error));
  else check(`S9-${who}`, !!s.error, `${who} refused an upload link`, msg(s.error));
}

// S10 Bucket limits enforced on the token upload (runs as superuser).
r = await signAndUpload(
  ids.admin,
  `${folder()}/big.png`,
  Buffer.concat([img, Buffer.alloc(5 * 1024 * 1024 + 1 - img.length)]),
  "image/png",
);
check(
  "S10a",
  !r.signError && !!r.uploadError,
  "file over 5 MiB refused by the bucket limit",
  msg(r.uploadError),
);
r = await signAndUpload(
  ids.admin,
  `${folder()}/ok.png`,
  Buffer.concat([img, Buffer.alloc(5 * 1024 * 1024 - img.length)]),
  "image/png",
);
check(
  "S10b",
  !r.uploadError,
  "file of exactly 5 MiB accepted (bytes later checked by the app)",
  msg(r.uploadError),
);
r = await signAndUpload(
  ids.admin,
  `${folder()}/pic.png`,
  Buffer.from("<svg/>"),
  "image/svg+xml",
);
check(
  "S10c",
  !!r.uploadError,
  "SVG content type refused by the bucket",
  msg(r.uploadError),
);
r = await signAndUpload(
  ids.admin,
  `${folder()}/pic.png`,
  Buffer.from("<html>"),
  "text/html",
);
check(
  "S10d",
  !!r.uploadError,
  "HTML content type refused by the bucket",
  msg(r.uploadError),
);

// S11 Unsafe paths refused at signing.
for (const bad of [
  "hero.png",
  `${folder()}/nested/hero.png`,
  `${folder()}/hero.svg`,
  `${folder()}/page.html`,
  `${folder().toUpperCase()}/hero.png`,
]) {
  const s = await client(ids.admin).createSignedUploadUrl(bad);
  check(`S11 ${bad.slice(-22)}`, !!s.error, "unsafe path refused", msg(s.error));
}

// S12 Read isolation and private bucket.
for (const [who, sub] of [
  ["Trainer", ids.trainer],
  ["Student", ids.student],
  ["inactive Admin", ids.inactive],
  ["anon", null],
]) {
  const d = await client(sub).download(p1);
  const l = await client(sub).list(p1.split("/")[0]);
  check(
    `S12-${who}`,
    !!d.error && (l.data ?? []).length === 0,
    `${who} cannot download or list website media`,
    msg(d.error),
  );
}
const pub = await fetch(`${URL_BASE}/object/public/${BUCKET}/${p1}`);
check(
  "S12-public",
  pub.status >= 400,
  "public URL refused (private bucket)",
  String(pub.status),
);
const pre = await client(ids.admin).createSignedUrls([p1], 300);
check(
  "S12-preview",
  !pre.error && !!pre.data[0]?.signedUrl,
  "Admin gets a short-lived private preview link",
  msg(pre.error),
);
const preT = await client(ids.trainer).createSignedUrls([p1], 300);
check(
  "S12-preview-trainer",
  !!preT.error || !preT.data[0]?.signedUrl,
  "Trainer gets no preview link",
  msg(preT.error),
);

// S13 Registration cross-checks against what Storage recorded.
const p13 = `${folder()}/lie.png`;
await signAndUpload(ids.admin, p13, img, "image/png");
r = register(ids.admin, p13, img.length + 1);
check("S13a", !r.ok, "size different from Storage's record refused", r.out);
r = register(ids.admin, p13, img.length, 64, 48, "image/webp");
check("S13b", !r.ok, "type different from Storage's record refused", r.out);
r = register(ids.admin, `${folder()}/never-uploaded.png`, 100);
check("S13c", !r.ok, "registering a path with no stored file refused", r.out);

// S14 Findings probes (reported, not hidden).
// a) The upload token is not single-use: after the file is removed, it can upload again until it expires.
const p14 = `${folder()}/again.png`;
const s14 = await client(ids.admin).createSignedUploadUrl(p14);
await client(null).uploadToSignedUrl(
  p14,
  s14.data.token,
  new Blob([img], { type: "image/png" }),
  { contentType: "image/png" },
);
const second = await client(null).uploadToSignedUrl(
  p14,
  s14.data.token,
  new Blob([img], { type: "image/png" }),
  { contentType: "image/png" },
);
check(
  "S14a",
  !!second.error,
  "reusing a token while the file exists is refused (no overwrite)",
  msg(second.error),
);
await client(ids.admin).remove([p14]);
const third = await client(null).uploadToSignedUrl(
  p14,
  s14.data.token,
  new Blob([img], { type: "image/png" }),
  { contentType: "image/png" },
);
results.push(
  `INFO S14b: token reuse after removal ${third.error ? "refused" : "ACCEPTED (unregistered file again, owned by the signer; cleaned up like any incomplete upload)"}`,
);
// b) Admin deactivated after getting a link: upload still lands (token upload runs as Storage superuser), registration refused.
const p15 = `${folder()}/late.png`;
const s15 = await client(ids.admin2).createSignedUploadUrl(p15);
sql(`update admins set status='inactive' where auth_user_id='${ids.admin2}'`);
const late = await client(null).uploadToSignedUrl(
  p15,
  s15.data.token,
  new Blob([img], { type: "image/png" }),
  { contentType: "image/png" },
);
const lateReg = register(ids.admin2, p15, img.length);
sql(`update admins set status='active' where auth_user_id='${ids.admin2}'`);
results.push(
  `INFO S14c: link signed before deactivation: upload ${late.error ? "refused" : "ACCEPTED"}, registration ${lateReg.ok ? "ACCEPTED" : "refused"}`,
);
check(
  "S14c",
  !lateReg.ok,
  "deactivated Admin cannot register a file uploaded with an earlier link",
  lateReg.out,
);
// c) Wrong bytes with an image content type: Storage accepts (it trusts the declared type); the app's inspectImage must reject.
const p16 = `${folder()}/fake.png`;
r = await signAndUpload(ids.admin, p16, Buffer.from("not an image at all"), "image/png");
results.push(
  `INFO S14d: non-image bytes declared image/png: Storage ${r.uploadError ? "refused" : "ACCEPTED"}; content check is the app's job (inspectImage) before registration`,
);

console.log(results.join("\n"));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
