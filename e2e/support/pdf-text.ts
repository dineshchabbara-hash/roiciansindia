import { inflateSync } from "node:zlib";

/**
 * Reads the printed text back out of a receipt PDF rendered by
 * @react-pdf/renderer (same approach as lib/pdf/__tests__/receipt.test.ts):
 * every content stream is inflated (or read as-is when uncompressed) and
 * the hex-encoded runs of each TJ/Tj operator are decoded — the standard
 * Helvetica fonts use single-byte WinAnsi codes. Text operators are joined
 * without separators, since one visual line is often split across several.
 */
export function pdfText(pdf: Buffer): string {
  const raw = pdf.toString("latin1");
  const runs: string[] = [];
  const streamPattern = /stream\r?\n/g;
  let match: RegExpExecArray | null;
  while ((match = streamPattern.exec(raw)) !== null) {
    const start = match.index + match[0].length;
    const end = raw.indexOf("endstream", start);
    if (end < 0) break;
    const body = raw.slice(start, end);
    let content: string;
    try {
      content = inflateSync(Buffer.from(body, "latin1")).toString("latin1");
    } catch {
      content = body;
    }
    for (const op of content.matchAll(/\[(.*?)\]\s*TJ|<([0-9a-fA-F]*)>\s*Tj/g)) {
      const hexRuns =
        op[1] !== undefined
          ? [...op[1].matchAll(/<([0-9a-fA-F]*)>/g)].map((m) => m[1])
          : [op[2]];
      runs.push(
        hexRuns.map((hex) => Buffer.from(hex, "hex").toString("latin1")).join(""),
      );
    }
  }
  return runs.join("");
}
