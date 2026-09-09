import { notFound } from "next/navigation";
import { StudentForm } from "@/components/admin/students/student-form";
import { updateStudentAction } from "@/lib/actions/students";
import { getStudentProfile } from "@/lib/data/students";
import { getPhoneCountry } from "@/lib/domain/students";
import { DEFAULT_PHONE_COUNTRY } from "@/lib/domain/phone-countries";

export const dynamic = "force-dynamic";

export default async function EditStudentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const result = await getStudentProfile(id);

  if (!result.ok) {
    notFound();
  }

  const boundAction = updateStudentAction.bind(null, id);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">
          Edit {result.data.firstName} {result.data.lastName}
        </h1>
        <p className="text-muted-foreground font-mono text-sm">
          {result.data.studentCode}
        </p>
      </div>
      <StudentForm
        action={boundAction}
        defaultValues={{
          ...result.data,
          // The stored phone is already E.164 (+<country><number>) — derive
          // which country to pre-select from the number itself, so editing
          // a non-Indian student's profile doesn't default the selector
          // back to India.
          phoneCountry: getPhoneCountry(result.data.phone) ?? DEFAULT_PHONE_COUNTRY,
        }}
        submitLabel="Save changes"
      />
    </div>
  );
}
