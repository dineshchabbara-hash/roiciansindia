import type { MaterialRow } from "@/lib/data/materials";
import { MaterialViewButton } from "@/components/admin/materials/material-view-button";

const MATERIAL_TYPE_LABELS: Record<MaterialRow["materialType"], string> = {
  file: "File",
  link: "Link",
  video: "Video",
};

export function MaterialList({ materials }: { materials: MaterialRow[] }) {
  if (materials.length === 0) {
    return <p className="text-muted-foreground text-sm">No materials uploaded yet.</p>;
  }

  return (
    <ul className="flex flex-col gap-2">
      {materials.map((material) => (
        <li
          key={material.id}
          className="flex items-center justify-between gap-3 border-b pb-2 text-sm last:border-0 last:pb-0"
        >
          <div className="flex min-w-0 flex-col">
            <span className="truncate font-medium">{material.title}</span>
            <span className="text-muted-foreground truncate text-xs">
              {MATERIAL_TYPE_LABELS[material.materialType]}
              {material.displayFileName ? ` · ${material.displayFileName}` : ""}
              {" · uploaded by "}
              {material.uploadedByType === "admin" ? "Admin" : "Trainer"}
              {material.moduleTitle !== undefined &&
                ` · ${material.moduleTitle ? `Module: ${material.moduleTitle}` : "Program-level"}`}
            </span>
          </div>
          <MaterialViewButton materialId={material.id} />
        </li>
      ))}
    </ul>
  );
}
