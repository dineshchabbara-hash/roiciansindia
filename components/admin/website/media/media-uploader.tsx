"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  completeMediaUploadAction,
  prepareMediaUploadAction,
} from "@/lib/actions/website-media";
import {
  ALT_TEXT_MAX,
  MEDIA_ACCEPT,
  MEDIA_TYPE_LABELS,
  altTextProblem,
  formatBytes,
  inspectImage,
  type ImageInfo,
} from "@/lib/domain/website-media";
import { uploadToSignedMediaUrl } from "@/lib/website-media-upload";

type Phase = "idle" | "checking" | "uploading" | "verifying";

const PHASE_LABELS: Record<Exclude<Phase, "idle">, string> = {
  checking: "Checking the file…",
  uploading: "Uploading…",
  verifying: "Checking the uploaded image…",
};

/**
 * Phase 22B-3 upload form. The browser checks the file first (for quick
 * feedback only), then the server prepares a one-time upload link, the file
 * goes straight to the private bucket, and the server checks the stored
 * bytes before recording the image as a Draft.
 */
export function MediaUploader() {
  const router = useRouter();
  const id = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [info, setInfo] = useState<ImageInfo | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [altText, setAltText] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [outcome, setOutcome] = useState<
    { kind: "error"; text: string } | { kind: "done"; text: string; id: string } | null
  >(null);

  const altProblem = altText.trim() === "" ? null : altTextProblem(altText);
  const busy = phase !== "idle";

  async function chooseFile(next: File | null) {
    setOutcome(null);
    setFile(next);
    setInfo(null);
    setFileError(null);
    if (!next) return;
    setPhase("checking");
    const check = inspectImage(new Uint8Array(await next.arrayBuffer()));
    setPhase("idle");
    if (check.ok) setInfo(check.info);
    else setFileError(check.reason);
  }

  async function upload(event: React.FormEvent) {
    event.preventDefault();
    if (!file || !info || altProblem || busy) return;
    setOutcome(null);
    setPhase("uploading");
    try {
      const prepared = await prepareMediaUploadAction({
        fileName: file.name,
        byteSize: file.size,
        mimeType: info.type,
        altText,
      });
      if (!prepared.ok) {
        setOutcome({ kind: "error", text: prepared.error });
        return;
      }
      const sent = await uploadToSignedMediaUrl(
        prepared.path,
        prepared.token,
        file,
        info.type,
      );
      if (!sent.ok) {
        setOutcome({ kind: "error", text: sent.error });
        return;
      }
      setPhase("verifying");
      const done = await completeMediaUploadAction({ path: prepared.path, altText });
      if (!done.ok) {
        setOutcome({ kind: "error", text: done.error });
        return;
      }
      setOutcome({
        kind: "done",
        id: done.id,
        text: `Uploaded "${file.name}" as a Draft. Add alt text and approve it before it can be used.`,
      });
      setFile(null);
      setInfo(null);
      setAltText("");
      if (fileRef.current) fileRef.current.value = "";
      router.refresh();
    } catch {
      setOutcome({ kind: "error", text: "The upload did not finish. Please try again." });
    } finally {
      setPhase("idle");
    }
  }

  return (
    <form
      onSubmit={upload}
      aria-label="Upload an image"
      className="flex flex-col gap-3 rounded-md border p-4"
      noValidate
    >
      <h2 className="text-base font-semibold">Upload an image</h2>
      <p className="text-muted-foreground text-xs">
        JPEG, PNG or WebP, up to 5 MB. Use original or licensed images only. New images
        are private Drafts until approved.
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-file`}>Image file</Label>
          <Input
            ref={fileRef}
            id={`${id}-file`}
            type="file"
            accept={MEDIA_ACCEPT}
            disabled={busy}
            aria-invalid={fileError ? true : undefined}
            aria-describedby={`${id}-file-help`}
            onChange={(e) => void chooseFile(e.target.files?.[0] ?? null)}
          />
          <p id={`${id}-file-help`} className="text-xs">
            {fileError ? (
              <span className="text-destructive">{fileError}</span>
            ) : info && file ? (
              <span className="text-muted-foreground">
                {MEDIA_TYPE_LABELS[info.type]} · {info.width} × {info.height} px ·{" "}
                {formatBytes(file.size)}
              </span>
            ) : (
              <span className="text-muted-foreground">
                The file content is checked, not just its name.
              </span>
            )}
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-alt`}>Alt text (can be added later)</Label>
          <Input
            id={`${id}-alt`}
            value={altText}
            maxLength={ALT_TEXT_MAX}
            disabled={busy}
            autoComplete="off"
            aria-invalid={altProblem ? true : undefined}
            aria-describedby={`${id}-alt-help`}
            onChange={(e) => setAltText(e.target.value)}
          />
          <p id={`${id}-alt-help`} className="text-xs">
            {altProblem ? (
              <span className="text-destructive">{altProblem}</span>
            ) : (
              <span className="text-muted-foreground">
                Describe what the image shows. Required before approval.
              </span>
            )}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" disabled={!info || !!altProblem || busy}>
          <Upload aria-hidden /> {busy ? "Uploading…" : "Upload image"}
        </Button>
        {phase !== "idle" && (
          <p role="status" className="text-muted-foreground text-xs">
            {PHASE_LABELS[phase]}
          </p>
        )}
        {outcome?.kind === "error" && (
          <p role="alert" className="text-destructive text-xs">
            {outcome.text}
          </p>
        )}
        {outcome?.kind === "done" && (
          <p role="status" className="text-xs text-green-800 dark:text-green-300">
            {outcome.text}{" "}
            <Link
              href={`/admin/website/media/${outcome.id}`}
              className="font-medium underline underline-offset-4"
            >
              Open image details
            </Link>
          </p>
        )}
      </div>
    </form>
  );
}
