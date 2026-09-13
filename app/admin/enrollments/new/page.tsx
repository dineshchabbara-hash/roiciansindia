import { EnrollmentForm } from "@/components/admin/enrollments/enrollment-form";
import { createEnrollmentAction } from "@/lib/actions/enrollments";
import {
  getBatchOptionsForEnrollment,
  getCompanyDefaultTaxRatePercent,
  getProgramPricingOptions,
  getStudentOptions,
} from "@/lib/data/enrollments";

export const dynamic = "force-dynamic";

export default async function NewEnrollmentPage() {
  const [studentOptionsResult, programOptionsResult, batchOptionsResult, taxRateResult] =
    await Promise.all([
      getStudentOptions(),
      getProgramPricingOptions(),
      getBatchOptionsForEnrollment(),
      getCompanyDefaultTaxRatePercent(),
    ]);

  const firstError = [
    studentOptionsResult,
    programOptionsResult,
    batchOptionsResult,
  ].find((result) => !result.ok);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Add Enrollment</h1>
        <p className="text-muted-foreground text-sm">
          Links a Student to a Program (and optionally a Batch) with its own commercial
          terms. New enrollments start in Lead status.
        </p>
      </div>
      {firstError && !firstError.ok ? (
        <p role="alert" className="text-destructive text-sm">
          {firstError.error}
        </p>
      ) : (
        <EnrollmentForm
          action={createEnrollmentAction}
          studentOptions={studentOptionsResult.ok ? studentOptionsResult.data : []}
          programOptions={programOptionsResult.ok ? programOptionsResult.data : []}
          batchOptions={batchOptionsResult.ok ? batchOptionsResult.data : []}
          companyDefaultTaxRatePercent={taxRateResult.ok ? taxRateResult.data : "0"}
        />
      )}
    </div>
  );
}
