import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * Manual-acceptance correction (Sept 2026): Reset did not clear every
 * filter — React reconciles the same already-mounted <select>/<input> DOM
 * nodes across a client-side navigation, and an uncontrolled field's
 * `defaultValue` is only honored the first time a node is created, so the
 * previously-selected Student/Program/Batch visually survived even after
 * the URL/searchParams (and thus these props) had already gone back to
 * empty. These tests exercise the real EnrollmentFilters component and its
 * real props — sourced from the URL by the parent Server Component — via
 * `rerender`, the same way a Reset/Apply navigation re-renders it with
 * fresh props.
 */

import { EnrollmentFilters } from "@/components/admin/enrollments/enrollment-filters";

const studentOptions = [
  { id: "student-1", firstName: "Demo", lastName: "Student", studentCode: "10004" },
];

const programOptions = [
  { id: "program-qa", name: "AI Powered QA" },
  { id: "program-fsd", name: "Full Stack Development" },
];

const batchOptions = [
  { id: "batch-sep", name: "Sep 2026", programId: "program-qa" },
  { id: "batch-jan", name: "Jan 2027", programId: "program-fsd" },
];

const filledProps = {
  q: "ENR-000001",
  studentId: "student-1",
  programId: "program-qa",
  batchId: "batch-sep",
  status: "enrolled",
};

function renderFilters(props: Partial<typeof filledProps> = filledProps) {
  return render(
    <EnrollmentFilters
      {...props}
      studentOptions={studentOptions}
      programOptions={programOptions}
      batchOptions={batchOptions}
    />,
  );
}

describe("EnrollmentFilters — Reset clears every filter", () => {
  it("(1) Reset clears Search", () => {
    const { rerender } = renderFilters(filledProps);
    expect(screen.getByLabelText("Search")).toHaveValue("ENR-000001");

    rerender(
      <EnrollmentFilters
        studentOptions={studentOptions}
        programOptions={programOptions}
        batchOptions={batchOptions}
      />,
    );
    expect(screen.getByLabelText("Search")).toHaveValue("");
  });

  it("(2) Reset clears Student back to 'All students'", () => {
    const { rerender } = renderFilters(filledProps);
    expect(screen.getByLabelText("Student")).toHaveValue("student-1");

    rerender(
      <EnrollmentFilters
        studentOptions={studentOptions}
        programOptions={programOptions}
        batchOptions={batchOptions}
      />,
    );
    expect(screen.getByLabelText("Student")).toHaveValue("");
    expect(screen.getByLabelText("Student")).toHaveDisplayValue("All students");
  });

  it("(3) Reset clears Program back to 'All programs'", () => {
    const { rerender } = renderFilters(filledProps);
    expect(screen.getByLabelText("Program")).toHaveValue("program-qa");

    rerender(
      <EnrollmentFilters
        studentOptions={studentOptions}
        programOptions={programOptions}
        batchOptions={batchOptions}
      />,
    );
    expect(screen.getByLabelText("Program")).toHaveValue("");
    expect(screen.getByLabelText("Program")).toHaveDisplayValue("All programs");
  });

  it("(4) Reset clears Batch back to 'All batches'", () => {
    const { rerender } = renderFilters(filledProps);
    expect(screen.getByLabelText("Batch")).toHaveValue("batch-sep");

    rerender(
      <EnrollmentFilters
        studentOptions={studentOptions}
        programOptions={programOptions}
        batchOptions={batchOptions}
      />,
    );
    expect(screen.getByLabelText("Batch")).toHaveValue("");
    expect(screen.getByLabelText("Batch")).toHaveDisplayValue("All batches");
  });

  it("(5) Reset clears Status back to 'All statuses'", () => {
    const { rerender } = renderFilters(filledProps);
    expect(screen.getByLabelText("Status")).toHaveValue("enrolled");

    rerender(
      <EnrollmentFilters
        studentOptions={studentOptions}
        programOptions={programOptions}
        batchOptions={batchOptions}
      />,
    );
    expect(screen.getByLabelText("Status")).toHaveValue("");
    expect(screen.getByLabelText("Status")).toHaveDisplayValue("All statuses");
  });

  // (6) Reset removes all Enrollment filter query parameters — the Reset
  // control is a plain <Link> to the query-string-free base path,
  // regardless of whatever filters are currently applied.
  it("(6) the Reset link always points at the query-string-free base path", () => {
    renderFilters(filledProps);
    expect(screen.getByRole("link", { name: "Reset" })).toHaveAttribute(
      "href",
      "/admin/enrollments",
    );
  });

  // (7) Program reset also clears Batch — proven together above (tests 3
  // and 4 both assert against the very same rerender-to-empty-props call,
  // i.e. a single Reset clearing both at once), asserted once more here
  // explicitly against one shared rerender for clarity.
  it("(7) resetting Program together with the rest also clears Batch", () => {
    const { rerender } = renderFilters(filledProps);
    rerender(
      <EnrollmentFilters
        studentOptions={studentOptions}
        programOptions={programOptions}
        batchOptions={batchOptions}
      />,
    );
    expect(screen.getByLabelText("Program")).toHaveValue("");
    expect(screen.getByLabelText("Batch")).toHaveValue("");
  });

  // (9) After Reset, no filter value remains selected anywhere in the
  // form — the same props (all undefined) that the parent Server
  // Component would render for the unfiltered `/admin/enrollments` URL
  // (searchEnrollments({}) itself is untouched and already covered by
  // lib/data/__tests__/enrollments.test.ts).
  it("(9) after Reset no filter field carries a leftover selection", () => {
    const { rerender } = renderFilters(filledProps);
    rerender(
      <EnrollmentFilters
        studentOptions={studentOptions}
        programOptions={programOptions}
        batchOptions={batchOptions}
      />,
    );
    expect(screen.getByLabelText("Search")).toHaveValue("");
    expect(screen.getByLabelText("Student")).toHaveValue("");
    expect(screen.getByLabelText("Program")).toHaveValue("");
    expect(screen.getByLabelText("Batch")).toHaveValue("");
    expect(screen.getByLabelText("Status")).toHaveValue("");
  });
});

describe("EnrollmentFilters — Program/Batch dependency", () => {
  it("(8) changing Program clears an incompatible Batch immediately, client-side", async () => {
    const user = userEvent.setup();
    renderFilters(filledProps);
    expect(screen.getByLabelText("Batch")).toHaveValue("batch-sep");

    await user.selectOptions(screen.getByLabelText("Program"), "program-fsd");

    expect(screen.getByLabelText("Batch")).toHaveValue("");
  });

  it("only offers Batches belonging to the selected Program", async () => {
    const user = userEvent.setup();
    renderFilters({ ...filledProps, batchId: undefined });

    await user.selectOptions(screen.getByLabelText("Program"), "program-fsd");

    const batchSelect = screen.getByLabelText("Batch") as HTMLSelectElement;
    const optionLabels = Array.from(batchSelect.options).map((o) => o.textContent);
    expect(optionLabels).toEqual(["All batches", "Jan 2027"]);
  });

  it("offers every Batch when no Program is selected", () => {
    renderFilters({ ...filledProps, programId: undefined, batchId: undefined });
    const batchSelect = screen.getByLabelText("Batch") as HTMLSelectElement;
    const optionLabels = Array.from(batchSelect.options).map((o) => o.textContent);
    expect(optionLabels).toEqual(["All batches", "Sep 2026", "Jan 2027"]);
  });
});

describe("EnrollmentFilters — Apply keeps working after a Reset", () => {
  // (10) A reset-then-refill cycle must not leave the form stuck: fields
  // remain interactive and correctly named for the next GET submission.
  it("(10) fields remain interactive and correctly named after a Reset remount", async () => {
    const user = userEvent.setup();
    const { rerender } = renderFilters(filledProps);

    rerender(
      <EnrollmentFilters
        studentOptions={studentOptions}
        programOptions={programOptions}
        batchOptions={batchOptions}
      />,
    );

    await user.type(screen.getByLabelText("Search"), "ENR-000099");
    await user.selectOptions(screen.getByLabelText("Student"), "student-1");
    await user.selectOptions(screen.getByLabelText("Program"), "program-qa");
    await user.selectOptions(screen.getByLabelText("Batch"), "batch-sep");
    await user.selectOptions(screen.getByLabelText("Status"), "enrolled");

    expect(screen.getByLabelText("Search")).toHaveValue("ENR-000099");
    expect(screen.getByLabelText("Student")).toHaveValue("student-1");
    expect(screen.getByLabelText("Program")).toHaveValue("program-qa");
    expect(screen.getByLabelText("Batch")).toHaveValue("batch-sep");
    expect(screen.getByLabelText("Status")).toHaveValue("enrolled");

    // The real submission target — Apply is a plain GET, so the browser
    // (not this test) performs the actual navigation; this asserts the
    // form still points at the right endpoint and every field still
    // carries the `name` the server reads from searchParams.
    expect(screen.getByRole("button", { name: "Apply" }).closest("form")).toHaveAttribute(
      "action",
      "/admin/enrollments",
    );
    expect(screen.getByLabelText("Search")).toHaveAttribute("name", "q");
    expect(screen.getByLabelText("Student")).toHaveAttribute("name", "studentId");
    expect(screen.getByLabelText("Program")).toHaveAttribute("name", "programId");
    expect(screen.getByLabelText("Batch")).toHaveAttribute("name", "batchId");
    expect(screen.getByLabelText("Status")).toHaveAttribute("name", "status");
  });
});
