import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Phase 21A: receipts are issued automatically for every paid payment, so
 * any E2E suite that creates a paid payment through the app (Phase 20A
 * offline recording, Phase 20B webhooks, Phase 21A) also leaves one
 * `receipts` row and one PDF object in the private `receipts` bucket.
 *
 * This removes exactly the receipt of ONE exact payment id: the row is
 * read by that payment id, its PDF is removed by its own stored, exact
 * object path, then the row is deleted by its own id. Never by receipt
 * number, prefix, date, amount or bucket listing. The `receipt.issued`
 * audit row is history and is never touched.
 *
 * Returns a failure message, or null when the payment has no receipt left.
 */
export async function deleteReceiptOfPayment(
  supabase: SupabaseClient,
  paymentId: string,
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from("receipts")
      .select("id, pdf_path")
      .eq("payment_id", paymentId)
      .maybeSingle();
    if (error) return `receipt of payment ${paymentId}: ${error.message}`;
    if (!data) return null;

    const { error: removeError } = await supabase.storage
      .from("receipts")
      .remove([data.pdf_path as string]);
    if (removeError) return `receipt PDF of payment ${paymentId}: ${removeError.message}`;

    const { error: deleteError } = await supabase
      .from("receipts")
      .delete()
      .eq("id", data.id as string);
    if (deleteError) return `receipt ${data.id}: ${deleteError.message}`;
    return null;
  } catch (err) {
    return `receipt of payment ${paymentId}: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export type ReceiptRow = {
  id: string;
  receipt_number: string;
  pdf_path: string;
  pdf_generated_at: string | null;
};

/** Read-only: the receipt row of one exact payment id, or null. */
export async function readReceiptOfPayment(
  supabase: SupabaseClient,
  paymentId: string,
): Promise<ReceiptRow | null> {
  const { data, error } = await supabase
    .from("receipts")
    .select("id, receipt_number, pdf_path, pdf_generated_at")
    .eq("payment_id", paymentId)
    .maybeSingle();
  if (error) throw new Error(`Could not read the receipt: ${error.message}`);
  return (data as ReceiptRow | null) ?? null;
}
