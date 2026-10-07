"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { getCertificateDownloadUrlAction } from "@/lib/actions/certificates";

/**
 * Shared Admin/Student "Download" button — mints a fresh signed URL on
 * click and opens it in a new tab. Same window.open-before-await
 * discipline as components/admin/assignments/assignment-file-view-button.tsx
 * so the browser never treats the resulting navigation as an unrelated
 * popup; never a persisted/cached URL anywhere in this component's state.
 */
export function CertificateDownloadButton({ certificateId }: { certificateId: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={isPending}
        onClick={() => {
          setError(null);
          const newTab = window.open("", "_blank");
          startTransition(async () => {
            const result = await getCertificateDownloadUrlAction(certificateId);
            if (!result.ok) {
              newTab?.close();
              setError(result.error);
              return;
            }
            if (newTab) {
              newTab.location.href = result.url;
            } else {
              window.open(result.url, "_blank");
            }
          });
        }}
      >
        {isPending ? "Opening..." : "Download"}
      </Button>
      {error && (
        <span role="alert" className="text-destructive text-xs">
          {error}
        </span>
      )}
    </div>
  );
}
