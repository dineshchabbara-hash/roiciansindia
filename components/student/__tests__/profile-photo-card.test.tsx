import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/actions/profile-photos", () => ({
  uploadOwnProfilePhotoAction: vi.fn(),
  removeOwnProfilePhotoAction: vi.fn(),
}));

import { ProfilePhotoCard } from "@/components/student/profile-photo-card";

const STUDENT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-000000000001";

beforeEach(() => vi.clearAllMocks());

describe("ProfilePhotoCard (FR-41)", () => {
  it("shows a placeholder and an upload form when there is no photo", () => {
    render(
      <ProfilePhotoCard
        studentId={STUDENT_ID}
        hasPhoto={false}
        version="none"
        maxLabel="2 MB"
      />,
    );
    expect(screen.getByLabelText("No profile photo")).toBeInTheDocument();
    const input = screen.getByLabelText("Profile photo");
    expect(input).toHaveAttribute("type", "file");
    expect(input).toHaveAttribute("accept", "image/png,image/jpeg,image/webp");
    expect(
      screen.queryByRole("button", { name: "Remove photo" }),
    ).not.toBeInTheDocument();
    // Only the file is submitted — never a student id.
    const form = screen.getByRole("form", { name: "Upload profile photo" });
    expect(Array.from(form.querySelectorAll("input")).map((i) => i.name)).toEqual([
      "photo",
    ]);
  });

  it("shows the photo from the private route and offers removal", () => {
    render(
      <ProfilePhotoCard
        studentId={STUDENT_ID}
        hasPhoto
        version="abc123"
        maxLabel="2 MB"
      />,
    );
    expect(screen.getByRole("img", { name: "Your profile photo" })).toHaveAttribute(
      "src",
      `/api/students/${STUDENT_ID}/photo?v=abc123`,
    );
    expect(screen.getByRole("button", { name: "Remove photo" })).toBeInTheDocument();
  });
});
