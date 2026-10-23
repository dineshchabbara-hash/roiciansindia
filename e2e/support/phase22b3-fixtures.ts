import { deflateSync } from "node:zlib";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { RUN_ID, isIsolatedLocalSupabase, type TestAccount } from "./phase22b-fixtures";

/**
 * Node-side helpers for the Phase 22B-3 media suite
 * (e2e/phase22b3-website-media.spec.ts).
 *
 * ISOLATED ONLY, like the 22B-1 and 22B-2 fixtures: they refuse to run unless
 * PHASE22B_E2E_ISOLATED=1 and the Supabase URL is a local, disposable stack.
 * The suite also needs the reviewed media upload migration applied to that
 * stack (PHASE22B3_MEDIA_MIGRATION=1). Images are fictional gradients made in
 * code; nothing is uploaded anywhere but the throwaway local stack.
 */

export { RUN_ID, isIsolatedLocalSupabase };

export const MEDIA_BUCKET = "website-media";

/** The suite runs only once the reviewed media migration is in the local stack. */
export function isMediaMigrationApplied(): boolean {
  return process.env.PHASE22B3_MEDIA_MIGRATION === "1";
}

function guard() {
  if (!isIsolatedLocalSupabase()) {
    throw new Error(
      "Refusing to touch a database: Phase 22B E2E runs only against a local, disposable Supabase stack.",
    );
  }
}

function serviceClient(): SupabaseClient {
  guard();
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

/** A Supabase client signed in as this test account (its own RLS and Storage rights). */
export async function userClient(account: TestAccount): Promise<SupabaseClient> {
  guard();
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const { error } = await client.auth.signInWithPassword({
    email: account.email,
    password: account.password,
  });
  if (error) throw new Error(`Could not sign in ${account.role}: ${error.message}`);
  return client;
}

// ---------------------------------------------------------------------------
// Fictional images

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** A real PNG: a soft blue gradient with diagonal bands (fictional test image). */
export function makePng(width: number, height: number, shade = 0): Buffer {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  let i = 0;
  for (let y = 0; y < height; y += 1) {
    raw[i++] = 0; // no filter
    for (let x = 0; x < width; x += 1) {
      const band = ((x + y) >> 5) % 2 === 0;
      const t = x / Math.max(1, width - 1);
      raw[i++] = Math.round(35 + 206 * t) ^ (band ? 0 : 8);
      raw[i++] = Math.round(71 + 175 * t) ^ (band ? 0 : 8);
      raw[i++] = (208 + shade) & 0xff;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Verification reads (service role, local stack only)

export type MediaRow = {
  id: string;
  storage_path: string;
  mime_type: string;
  byte_size: number;
  width: number | null;
  height: number | null;
  alt_text: string | null;
  status: string;
  version: number;
};

/** The newest image whose file name is exactly this (paths are "<uuid>/<name>"). */
export async function readMediaByFileName(fileName: string): Promise<MediaRow | null> {
  const { data, error } = await serviceClient()
    .from("website_media_assets")
    .select(
      "id, storage_path, mime_type, byte_size, width, height, alt_text, status, version",
    )
    .like("storage_path", `%/${fileName}`)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(`Could not read media: ${error.message}`);
  return ((data ?? []) as MediaRow[])[0] ?? null;
}

export async function readMedia(id: string): Promise<MediaRow> {
  const { data, error } = await serviceClient()
    .from("website_media_assets")
    .select(
      "id, storage_path, mime_type, byte_size, width, height, alt_text, status, version",
    )
    .eq("id", id)
    .single();
  if (error) throw new Error(`Could not read media: ${error.message}`);
  return data as MediaRow;
}

/** Whether a file exists in website-media (service role listing). */
export async function storedFileExists(path: string): Promise<boolean> {
  const [folder, name] = path.split("/");
  const { data, error } = await serviceClient()
    .storage.from(MEDIA_BUCKET)
    .list(folder, { search: name });
  if (error) throw new Error(`Could not list storage: ${error.message}`);
  return (data ?? []).some((o) => o.name === name);
}

/** How many upload folders website-media holds (to prove nothing was stored). */
export async function countStoredFolders(): Promise<number> {
  const { data, error } = await serviceClient()
    .storage.from(MEDIA_BUCKET)
    .list("", { limit: 1000 });
  if (error) throw new Error(`Could not list storage: ${error.message}`);
  return (data ?? []).length;
}

export type AuditEntry = {
  action: string;
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null;
};

export async function readAuditEntries(entityId: string): Promise<AuditEntry[]> {
  const { data, error } = await serviceClient()
    .from("audit_logs")
    .select("action, before_data, after_data, created_at")
    .eq("entity_id", entityId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Could not read audit log: ${error.message}`);
  return (data ?? []) as AuditEntry[];
}

/** The latest revision of a website document, with its images. */
export async function readLatestRevisionImages(documentId: string) {
  const supabase = serviceClient();
  const { data: doc, error } = await supabase
    .from("website_documents")
    .select("latest_revision_id, published_revision_id")
    .eq("id", documentId)
    .single();
  if (error) throw new Error(`Could not read document: ${error.message}`);
  const d = doc as {
    latest_revision_id: string | null;
    published_revision_id: string | null;
  };
  const { data: rev } = await supabase
    .from("website_document_revisions")
    .select("hero_image_asset_id, social_image_asset_id, sections")
    .eq("id", d.latest_revision_id!)
    .single();
  return {
    latestRevisionId: d.latest_revision_id,
    publishedRevisionId: d.published_revision_id,
    ...(rev as {
      hero_image_asset_id: string | null;
      social_image_asset_id: string | null;
      sections: Array<{ imageAssetId?: string }>;
    }),
  };
}

/** HTTP status of the PUBLIC URL form for a private file (must not be 200). */
export async function publicUrlStatus(path: string): Promise<number> {
  guard();
  const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${MEDIA_BUCKET}/${path}`;
  const response = await fetch(url);
  return response.status;
}
