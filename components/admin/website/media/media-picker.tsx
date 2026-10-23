"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { EditorMedia } from "@/lib/data/website-media";
import { MediaImage, MediaStatusBadge } from "./media-image";

export type { EditorMedia };

export function findMedia(media: EditorMedia, id: string | null | undefined) {
  if (!id) return null;
  return media.chosen[id] ?? media.approved.find((o) => o.id === id) ?? null;
}

/**
 * Phase 22B-3 image choice for one slot (main image, social image or a
 * section image). Only Approved images are offered. A chosen image that is
 * no longer Approved is flagged, and publishing is held until it is fixed.
 */
export function MediaPicker({
  label,
  hint,
  value,
  media,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string | null;
  media: EditorMedia;
  onChange: (id: string | null) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const current = findMedia(media, value);
  const term = search.trim().toLowerCase();
  const options = media.approved.filter(
    (o) =>
      term === "" ||
      (o.altText ?? "").toLowerCase().includes(term) ||
      o.fileName.toLowerCase().includes(term),
  );

  return (
    <div className="flex flex-col gap-2" role="group" aria-labelledby={`${id}-label`}>
      <p id={`${id}-label`} className="text-sm font-medium">
        {label}
      </p>
      {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
      <div className="flex flex-wrap items-start gap-3">
        {value ? (
          <div className="flex min-w-0 items-start gap-3">
            <MediaImage
              src={current?.previewUrl ?? null}
              alt={current?.altText ?? ""}
              className="h-16 w-28 shrink-0 rounded border"
            />
            <div className="flex min-w-0 flex-col gap-1 text-xs">
              {current ? (
                <>
                  <span className="flex items-center gap-2">
                    <MediaStatusBadge status={current.status} />
                    <span className="truncate">{current.fileName}</span>
                  </span>
                  <span>{current.altText ?? "No alt text"}</span>
                  {current.status !== "approved" && (
                    <span className="text-amber-800 dark:text-amber-300">
                      This image is not Approved. Publishing is held until it is approved
                      or replaced.
                    </span>
                  )}
                </>
              ) : (
                <span className="text-amber-800 dark:text-amber-300">
                  This image could not be found. Choose another or remove it.
                </span>
              )}
            </div>
          </div>
        ) : (
          <p className="text-muted-foreground text-xs">No image chosen.</p>
        )}
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-expanded={open}
            aria-controls={`${id}-choices`}
            aria-label={`${value ? "Change" : "Choose"} ${label.toLowerCase()}`}
            onClick={() => setOpen((v) => !v)}
          >
            {value ? "Change image" : "Choose image"}
          </Button>
          {value && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-label={`Remove ${label.toLowerCase()}`}
              onClick={() => onChange(null)}
            >
              Remove
            </Button>
          )}
        </div>
      </div>
      {open && (
        <div id={`${id}-choices`} className="flex flex-col gap-2 rounded-md border p-3">
          {media.approved.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No Approved images yet. Upload and approve images in{" "}
              <Link
                href="/admin/website/media"
                className="text-primary underline underline-offset-4"
              >
                Media
              </Link>
              .
            </p>
          ) : (
            <>
              <label className="flex flex-col gap-1 text-xs">
                Search Approved images
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Alt text or file name"
                />
              </label>
              {options.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  No Approved image matches.
                </p>
              ) : (
                <ul className="grid max-h-72 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
                  {options.map((o) => (
                    <li key={o.id}>
                      <button
                        type="button"
                        aria-pressed={o.id === value}
                        aria-label={`Use image: ${o.altText ?? o.fileName}`}
                        className="hover:border-primary aria-pressed:border-primary aria-pressed:ring-primary flex w-full flex-col gap-1 rounded-md border p-1 text-left text-xs aria-pressed:ring-2"
                        onClick={() => {
                          onChange(o.id);
                          setOpen(false);
                        }}
                      >
                        <MediaImage
                          src={o.previewUrl}
                          alt=""
                          className="aspect-video w-full rounded"
                        />
                        <span className="line-clamp-2">{o.altText ?? o.fileName}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
