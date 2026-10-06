"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { MaterialFormState } from "@/lib/actions/materials";
import {
  MATERIAL_TYPES,
  type MaterialType,
  isMaterialExtensionAllowed,
  isMaterialFileSizeAllowed,
  materialFileSizeTooLargeError,
  MATERIAL_FILE_TYPE_ERROR,
  MATERIAL_MAX_DOCUMENT_SIZE_LABEL,
  MATERIAL_MAX_IMAGE_SIZE_LABEL,
} from "@/lib/domain/materials";

const initialState: MaterialFormState = {};

const MATERIAL_TYPE_LABELS: Record<MaterialType, string> = {
  file: "File",
  link: "Link",
  video: "Video",
};

/**
 * No Module picker here at all — the Trainer action it binds to
 * (createMyBatchMaterialAction/createMySessionMaterialAction,
 * lib/actions/trainer-materials.ts) only ever creates Batch- or
 * Session-scoped materials, matching materials_write_trainer RLS exactly
 * (no Program/Module branch exists for Trainer).
 */
export function TrainerCreateMaterialForm({
  action,
}: {
  action: (
    prevState: MaterialFormState,
    formData: FormData,
  ) => Promise<MaterialFormState>;
}) {
  const [state, formAction, isPending] = useActionState(action, initialState);
  const [materialType, setMaterialType] = useState<MaterialType>("file");
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [clientFileError, setClientFileError] = useState<string | null>(null);

  return (
    <form
      action={formAction}
      className="flex flex-col gap-2"
      noValidate
      onSubmit={(event) => {
        if (materialType !== "file") return;
        const fileInput = event.currentTarget.elements.namedItem(
          "file",
        ) as HTMLInputElement | null;
        const file = fileInput?.files?.[0];
        if (!file) return;
        if (!isMaterialExtensionAllowed(file.name)) {
          event.preventDefault();
          setClientFileError(MATERIAL_FILE_TYPE_ERROR);
          return;
        }
        if (!isMaterialFileSizeAllowed(file.name, file.size)) {
          event.preventDefault();
          setClientFileError(materialFileSizeTooLargeError(file.name));
        }
      }}
    >
      <Input name="title" placeholder="Title" required />
      <Input name="description" placeholder="Description (optional)" />

      <select
        name="materialType"
        value={materialType}
        onChange={(event) => {
          setMaterialType(event.target.value as MaterialType);
          setClientFileError(null);
        }}
        className="border-input h-9 w-fit rounded-md border bg-transparent px-3 text-sm shadow-xs"
      >
        {MATERIAL_TYPES.map((type) => (
          <option key={type} value={type}>
            {MATERIAL_TYPE_LABELS[type]}
          </option>
        ))}
      </select>

      {materialType === "file" ? (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-3">
            <Label
              htmlFor="trainerMaterialFile"
              className="border-input hover:bg-accent focus-within:ring-ring inline-flex h-9 w-fit cursor-pointer items-center rounded-md border bg-transparent px-3 text-sm font-medium shadow-xs focus-within:ring-2 focus-within:ring-offset-2"
            >
              Select file
              <input
                id="trainerMaterialFile"
                type="file"
                name="file"
                required
                className="sr-only"
                onChange={(event) => {
                  setSelectedFileName(event.target.files?.[0]?.name ?? null);
                  setClientFileError(null);
                }}
              />
            </Label>
            <span className="text-muted-foreground text-sm">
              {selectedFileName ?? "No file chosen"}
            </span>
          </div>
          <p className="text-muted-foreground text-xs">
            Documents up to {MATERIAL_MAX_DOCUMENT_SIZE_LABEL}, images up to{" "}
            {MATERIAL_MAX_IMAGE_SIZE_LABEL}.
          </p>
        </div>
      ) : (
        <Input name="externalUrl" placeholder="https://..." required />
      )}

      {clientFileError && <p className="text-destructive text-sm">{clientFileError}</p>}
      {state.formError && (
        <p role="alert" className="text-destructive text-sm">
          {state.formError}
        </p>
      )}
      {state.success && (
        <p className="text-sm text-green-700 dark:text-green-400">Uploaded</p>
      )}

      <Button type="submit" size="sm" disabled={isPending} className="w-fit">
        {isPending ? "Uploading..." : "Add material"}
      </Button>
    </form>
  );
}
