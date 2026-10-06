import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MaterialList } from "@/components/admin/materials/material-list";
import { CreateMaterialForm } from "@/components/admin/materials/create-material-form";
import type { MaterialRow } from "@/lib/data/materials";
import type { MaterialFormState } from "@/lib/actions/materials";

export function MaterialsCard({
  materials,
  action,
  moduleOptions,
}: {
  materials: MaterialRow[];
  action: (
    prevState: MaterialFormState,
    formData: FormData,
  ) => Promise<MaterialFormState>;
  moduleOptions?: Array<{ id: string; title: string }>;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Materials</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <MaterialList materials={materials} />
        <CreateMaterialForm action={action} moduleOptions={moduleOptions} />
      </CardContent>
    </Card>
  );
}
