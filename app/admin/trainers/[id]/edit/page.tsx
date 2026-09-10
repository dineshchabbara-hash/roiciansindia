import { notFound } from "next/navigation";
import { TrainerForm } from "@/components/admin/trainers/trainer-form";
import { updateTrainerAction } from "@/lib/actions/trainers";
import { getTrainerProfile } from "@/lib/data/trainers";
import { getPhoneCountry } from "@/lib/domain/trainers";
import { DEFAULT_PHONE_COUNTRY } from "@/lib/domain/phone-countries";

export const dynamic = "force-dynamic";

export default async function EditTrainerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const result = await getTrainerProfile(id);

  if (!result.ok) {
    notFound();
  }

  const boundAction = updateTrainerAction.bind(null, id);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">
          Edit {result.data.firstName} {result.data.lastName}
        </h1>
      </div>
      <TrainerForm
        action={boundAction}
        defaultValues={{
          ...result.data,
          // The stored phone (if any) is already E.164 — derive which
          // country to pre-select from the number itself, same reasoning
          // as the Student edit page.
          phoneCountry: result.data.phone
            ? (getPhoneCountry(result.data.phone) ?? DEFAULT_PHONE_COUNTRY)
            : DEFAULT_PHONE_COUNTRY,
        }}
        submitLabel="Save changes"
      />
    </div>
  );
}
