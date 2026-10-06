import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrainerMaterialList } from "@/components/trainer/materials/trainer-material-list";
import { TrainerCreateMaterialForm } from "@/components/trainer/materials/trainer-create-material-form";
import type { MaterialRow } from "@/lib/data/materials";
import type { MaterialFormState } from "@/lib/actions/materials";

export function TrainerMaterialsCard({
  materials,
  action,
}: {
  materials: MaterialRow[];
  action: (
    prevState: MaterialFormState,
    formData: FormData,
  ) => Promise<MaterialFormState>;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Materials</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <TrainerMaterialList materials={materials} />
        <TrainerCreateMaterialForm action={action} />
      </CardContent>
    </Card>
  );
}
