"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { getMaterialAccessUrlAction } from "@/lib/actions/materials";

/**
 * Same shared action as components/admin/materials/material-view-button.tsx
 * (getMaterialAccessUrlAction has no role branch of its own — the
 * caller's own RLS-scoped session is what actually authorizes it) —
 * duplicated here rather than imported from components/admin/ to match
 * this codebase's own established per-portal component isolation
 * (Admin/Trainer/Student each keep their own UI code, even where the
 * underlying logic is shared, same as the separate attendance roster
 * forms in Phase 13).
 */
export function TrainerMaterialViewButton({ materialId }: { materialId: string }) {
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
