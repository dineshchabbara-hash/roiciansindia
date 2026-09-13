"use client";

import { Fragment, useActionState, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { PAYMENT_PLAN_TYPES, suggestTaxAmount } from "@/lib/domain/enrollments";
import type { EnrollmentFormState } from "@/lib/actions/enrollments";
import type { ProgramPricingOption, BatchOption } from "@/lib/data/enrollments";

const initialState: EnrollmentFormState = {};

function FieldError({ errors }: { errors?: string[] }) {
  if (!errors || errors.length === 0) return null;
  return <p className="text-destructive text-sm">{errors[0]}</p>;
}

export function EnrollmentForm({
  action,
  studentOptions,
  programOptions,
  batchOptions,
  companyDefaultTaxRatePercent,
}: {
  action: (
    prevState: EnrollmentFormState,
    formData: FormData,
  ) => Promise<EnrollmentFormState>;
  studentOptions: Array<{
    id: string;
    firstName: string;
    lastName: string;
    studentCode: string;
  }>;
  programOptions: ProgramPricingOption[];
  batchOptions: BatchOption[];
  companyDefaultTaxRatePercent: string;
}) {
  const [state, formAction, isPending] = useActionState(action, initialState);

  // Same React-19-resets-uncontrolled-form-fields fix as
  // components/admin/batches/batch-form.tsx.
  const [priorState, setPriorState] = useState(state);
  const [generation, setGeneration] = useState(0);
  if (state !== priorState) {
    setPriorState(state);
    setGeneration((g) => g + 1);
  }

  const [selectedProgramId, setSelectedProgramId] = useState(
    state.submittedValues?.programId ?? "",
  );
  const [agreedFee, setAgreedFee] = useState(state.submittedValues?.agreedFee ?? "");
  const [discountAmount, setDiscountAmount] = useState(
    state.submittedValues?.discountAmount ?? "",
  );
  const [taxAmountTouched, setTaxAmountTouched] = useState(false);
  const [taxAmount, setTaxAmount] = useState(state.submittedValues?.taxAmount ?? "");

  const selectedProgram = useMemo(
    () => programOptions.find((p) => p.id === selectedProgramId) ?? null,
    [programOptions, selectedProgramId],
  );

  // Batch options are filtered to the selected Program client-side only for
  // display convenience — the server independently re-derives and checks
  // this relationship on submit (createEnrollmentRecord), never trusting
  // this filter for authorization.
  const filteredBatchOptions = useMemo(
    () => batchOptions.filter((b) => b.programId === selectedProgramId),
    [batchOptions, selectedProgramId],
  );

  function handleProgramChange(programId: string) {
    setSelectedProgramId(programId);
    const program = programOptions.find((p) => p.id === programId);
    if (program && !agreedFee) {
      setAgreedFee(program.regularFee);
    }
  }

  function recomputeSuggestedTax(nextAgreedFee: string, nextDiscountAmount: string) {
    if (taxAmountTouched || !selectedProgram) return;
    const rate =
      selectedProgram.taxRatePercent !== null
        ? Number(selectedProgram.taxRatePercent)
        : Number(companyDefaultTaxRatePercent);
    if (!nextAgreedFee || Number.isNaN(Number(nextAgreedFee))) return;
    setTaxAmount(
      String(
        suggestTaxAmount({
          agreedFee: nextAgreedFee,
          discountAmount: nextDiscountAmount || "0",
          taxRatePercent: rate,
        }),
      ),
    );
  }

  const value = (field: keyof NonNullable<EnrollmentFormState["submittedValues"]>) =>
    state.submittedValues?.[field] ?? undefined;

  return (
    <form action={formAction} className="flex max-w-2xl flex-col gap-4" noValidate>
      <Fragment key={generation}>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="studentId">Student</Label>
          <select
            id="studentId"
            name="studentId"
            defaultValue={value("studentId") ?? ""}
            aria-invalid={!!state.fieldErrors?.studentId}
            className="border-input h-9 rounded-md border bg-transparent px-2 text-sm shadow-xs"
          >
            <option value="">Select a student</option>
            {studentOptions.map((student) => (
              <option key={student.id} value={student.id}>
                {student.firstName} {student.lastName} ({student.studentCode})
              </option>
            ))}
          </select>
          <FieldError errors={state.fieldErrors?.studentId} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="programId">Program</Label>
          <select
            id="programId"
            name="programId"
            defaultValue={value("programId") ?? ""}
            onChange={(e) => handleProgramChange(e.target.value)}
            aria-invalid={!!state.fieldErrors?.programId}
            className="border-input h-9 rounded-md border bg-transparent px-2 text-sm shadow-xs"
          >
            <option value="">Select a program</option>
            {programOptions.map((program) => (
              <option key={program.id} value={program.id}>
                {program.name} ({program.programCode})
              </option>
            ))}
          </select>
          <FieldError errors={state.fieldErrors?.programId} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="batchId">Batch (optional)</Label>
          <select
            id="batchId"
            name="batchId"
            defaultValue={value("batchId") ?? ""}
            disabled={!selectedProgramId}
            aria-invalid={!!state.fieldErrors?.batchId}
            className="border-input h-9 rounded-md border bg-transparent px-2 text-sm shadow-xs disabled:opacity-50"
          >
            <option value="">
              {selectedProgramId ? "Not yet batch-assigned" : "Select a program first"}
            </option>
            {filteredBatchOptions.map((batch) => (
              <option key={batch.id} value={batch.id}>
                {batch.name}
              </option>
            ))}
          </select>
          <FieldError errors={state.fieldErrors?.batchId} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="enrollmentDate">Enrollment date (optional)</Label>
          <Input
            id="enrollmentDate"
            name="enrollmentDate"
            type="date"
            defaultValue={value("enrollmentDate") ?? undefined}
            aria-invalid={!!state.fieldErrors?.enrollmentDate}
          />
          <p className="text-muted-foreground text-xs">
            Defaults to today if left blank.
          </p>
          <FieldError errors={state.fieldErrors?.enrollmentDate} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="regularFee">Regular fee</Label>
            <Input
              id="regularFee"
              name="regularFee"
              inputMode="decimal"
              required
              defaultValue={
                value("regularFee") ?? selectedProgram?.regularFee ?? undefined
              }
              aria-invalid={!!state.fieldErrors?.regularFee}
            />
            <p className="text-muted-foreground text-xs">
              Reference only — the Program&apos;s listed fee at the time of enrollment.
            </p>
            <FieldError errors={state.fieldErrors?.regularFee} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="agreedFee">Agreed fee</Label>
            <Input
              id="agreedFee"
              name="agreedFee"
              inputMode="decimal"
              required
              value={agreedFee}
              onChange={(e) => {
                setAgreedFee(e.target.value);
                recomputeSuggestedTax(e.target.value, discountAmount);
              }}
              aria-invalid={!!state.fieldErrors?.agreedFee}
            />
            <FieldError errors={state.fieldErrors?.agreedFee} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="discountAmount">Discount amount (optional)</Label>
            <Input
              id="discountAmount"
              name="discountAmount"
              inputMode="decimal"
              value={discountAmount}
              onChange={(e) => {
                setDiscountAmount(e.target.value);
                recomputeSuggestedTax(agreedFee, e.target.value);
              }}
              aria-invalid={!!state.fieldErrors?.discountAmount}
            />
            <FieldError errors={state.fieldErrors?.discountAmount} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="discountReason">Discount reason (optional)</Label>
            <Input
              id="discountReason"
              name="discountReason"
              defaultValue={value("discountReason") ?? undefined}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="registrationFee">Registration fee (optional)</Label>
            <Input
              id="registrationFee"
              name="registrationFee"
              inputMode="decimal"
              defaultValue={
                value("registrationFee") ?? selectedProgram?.registrationFee ?? undefined
              }
              aria-invalid={!!state.fieldErrors?.registrationFee}
            />
            <FieldError errors={state.fieldErrors?.registrationFee} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="taxAmount">Tax amount (optional)</Label>
            <Input
              id="taxAmount"
              name="taxAmount"
              inputMode="decimal"
              value={taxAmount}
              onChange={(e) => {
                setTaxAmountTouched(true);
                setTaxAmount(e.target.value);
              }}
              aria-invalid={!!state.fieldErrors?.taxAmount}
            />
            <p className="text-muted-foreground text-xs">
              Suggested from the{" "}
              {selectedProgram?.taxRatePercent !== null ? "Program's" : "company default"}{" "}
              tax rate — editable.
            </p>
            <FieldError errors={state.fieldErrors?.taxAmount} />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="paymentPlanType">Payment plan (optional)</Label>
          <select
            id="paymentPlanType"
            name="paymentPlanType"
            defaultValue={value("paymentPlanType") ?? ""}
            className="border-input h-9 rounded-md border bg-transparent px-2 text-sm shadow-xs"
          >
            <option value="">—</option>
            {PAYMENT_PLAN_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
          <FieldError errors={state.fieldErrors?.paymentPlanType} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="source">Source (optional)</Label>
          <Input id="source" name="source" defaultValue={value("source") ?? undefined} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="notes">Notes (optional)</Label>
          <textarea
            id="notes"
            name="notes"
            rows={3}
            className="border-input rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs"
            defaultValue={value("notes") ?? undefined}
          />
        </div>
      </Fragment>

      {state.formError && (
        <p role="alert" className="text-destructive text-sm">
          {state.formError}
        </p>
      )}

      <Button type="submit" disabled={isPending} className="w-fit">
        {isPending ? "Saving..." : "Create enrollment"}
      </Button>
    </form>
  );
}
