import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Pagination } from "@/components/admin/pagination";

describe("Pagination", () => {
  it("renders nothing when there is only one page", () => {
    const { container } = render(
      <Pagination
        page={1}
        pageSize={20}
        total={5}
        basePath="/admin/students"
        searchParams={{}}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("disables Previous on the first page and Next on the last page", () => {
    render(
      <Pagination
        page={1}
        pageSize={20}
        total={45}
        basePath="/admin/students"
        searchParams={{}}
      />,
    );
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    expect(screen.getByRole("link", { name: "Next" })).toHaveAttribute(
      "href",
      "/admin/students?page=2",
    );
  });

  it("preserves existing search params in the page links", () => {
    render(
      <Pagination
        page={2}
        pageSize={20}
        total={45}
        basePath="/admin/students"
        searchParams={{ q: "priya", status: "active" }}
      />,
    );
    const nextLink = screen.getByRole("link", { name: "Next" });
    const href = nextLink.getAttribute("href")!;
    expect(href).toContain("q=priya");
    expect(href).toContain("status=active");
    expect(href).toContain("page=3");
  });

  it("shows the total count", () => {
    render(
      <Pagination
        page={1}
        pageSize={20}
        total={45}
        basePath="/admin/students"
        searchParams={{}}
      />,
    );
    expect(screen.getByText(/45 total/)).toBeInTheDocument();
  });
});
