import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { UpcomingClassesCard } from "@/components/admin/dashboard/upcoming-classes-card";
import type { UpcomingClassSession } from "@/lib/data/dashboard";

const sample: UpcomingClassSession = {
  id: "1",
  programName: "AI Powered QA / Software Testing",
  batchName: "September 2026 Weekend Batch",
  trainerName: "Assigned Trainer",
  sessionDate: "2026-09-13",
  startTime: "10:00:00",
  endTime: "13:00:00",
  status: "scheduled",
};

describe("UpcomingClassesCard", () => {
  it("shows the professional empty state when there is no data", () => {
    render(<UpcomingClassesCard data={[]} />);
    expect(screen.getByText("No upcoming classes")).toBeInTheDocument();
  });

  it("renders a safe error state", () => {
    render(<UpcomingClassesCard error="Could not load upcoming classes." />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not load upcoming classes.",
    );
  });

  it("renders session data including the trainer and time range", () => {
    render(<UpcomingClassesCard data={[sample]} />);
    expect(screen.getByText("September 2026 Weekend Batch")).toBeInTheDocument();
    expect(screen.getByText(/Assigned Trainer/)).toBeInTheDocument();
    expect(screen.getByText("10:00–13:00")).toBeInTheDocument();
  });
});
