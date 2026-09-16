import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PipelineValueCard } from "@/components/admin/dashboard/pipeline-value-card";

describe("PipelineValueCard", () => {
  it("shows a real zero, not a blank, when there is no pipeline value", () => {
    render(<PipelineValueCard pipelineValuePaise={0} pipelineEnrollmentCount={0} />);
    expect(screen.getByText(/₹0|₹\s?0/)).toBeInTheDocument();
    expect(screen.getByText(/across 0 lead\/applicant records/)).toBeInTheDocument();
  });

  it("renders a real pipeline total and singular/plural record count correctly", () => {
    render(
      <PipelineValueCard pipelineValuePaise={3000000} pipelineEnrollmentCount={1} />,
    );
    expect(screen.getByText(/30,000/)).toBeInTheDocument();
    expect(screen.getByText(/across 1 lead\/applicant record$/)).toBeInTheDocument();
  });

  it("renders a safe error state", () => {
    render(
      <PipelineValueCard error="Could not load enrollment financial classification summary." />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not load enrollment financial classification summary.",
    );
  });

  // (17) The label and explanatory text must match what is actually
  // calculated — a raw fee sum, never confirmed revenue or outstanding debt.
  it("(17) label and explanation match the implemented calculation", () => {
    render(<PipelineValueCard pipelineValuePaise={0} pipelineEnrollmentCount={0} />);
    expect(screen.getByText("Potential Pipeline Value")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Indicative fees associated with leads and applicants. Not confirmed revenue or outstanding debt.",
      ),
    ).toBeInTheDocument();
  });
});
