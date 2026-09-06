import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Users } from "lucide-react";
import { MetricCard } from "@/components/admin/dashboard/metric-card";

describe("MetricCard", () => {
  it("renders a numeric zero as the visible text '0', not blank", () => {
    render(<MetricCard label="Total Students" value={0} icon={Users} />);
    expect(screen.getByText("Total Students")).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("renders a formatted string value (e.g. currency) as given", () => {
    render(<MetricCard label="Revenue Collected" value="₹20,000" icon={Users} />);
    expect(screen.getByText("₹20,000")).toBeInTheDocument();
  });
});
