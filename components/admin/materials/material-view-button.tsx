"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { getMaterialAccessUrlAction } from "@/lib/actions/materials";

/**
 * Mints a fresh signed URL (or resolves the stored external_url) on click
 * and opens it in a new tab — never a persisted/cached URL anywhere in
 * this component's own state, matching lib/data/materials.ts's own
 * getMaterialAccessUrl contract. window.open is called synchronously in
 * the click handler's own callback (not after an extra await) specifically
 * so browsers don't treat the resulting navigation as an unrelated popup.
 */
export function MaterialViewButton({ materialId }: { materialId: string }) {
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
            const result = await getMaterialAccessUrlAction(materialId);
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
        {isPending ? "Opening..." : "View"}
      </Button>
      {error && (
        <span role="alert" className="text-destructive text-xs">
          {error}
        </span>
      )}
    </div>
  );
}
