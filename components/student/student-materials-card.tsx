import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StudentMaterialViewButton } from "@/components/student/student-material-view-button";
import type { MaterialRow } from "@/lib/data/materials";

const MATERIAL_TYPE_LABELS: Record<MaterialRow["materialType"], string> = {
  file: "File",
  link: "Link",
  video: "Video",
};

/**
 * Read-only — no mutation controls anywhere in this component, matching
 * components/student/student-payment-plan-card.tsx's own precedent. RLS
 * (materials_select_student, narrowed by 20260101000026 to enrolled/
 * active/on_hold/completed enrollments only) is the real authorization
 * boundary; lib/data/student-portal.ts's own getMyMaterialsForEnrollment
 * re-scopes by the caller's own enrollment first either way.
 */
export function StudentMaterialsCard({ materials }: { materials: MaterialRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Materials</CardTitle>
      </CardHeader>
      <CardContent>
        {materials.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No materials have been shared for this enrollment yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {materials.map((material) => (
              <li
                key={material.id}
                className="flex items-center justify-between gap-3 border-b pb-2 text-sm last:border-0 last:pb-0"
              >
                <div className="flex min-w-0 flex-col">
                  <span className="truncate font-medium">{material.title}</span>
                  <span className="text-muted-foreground truncate text-xs">
                    {material.scopeLabel ? `${material.scopeLabel} · ` : ""}
                    {MATERIAL_TYPE_LABELS[material.materialType]}
                    {material.displayFileName ? ` · ${material.displayFileName}` : ""}
                  </span>
                </div>
                <StudentMaterialViewButton materialId={material.id} />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
