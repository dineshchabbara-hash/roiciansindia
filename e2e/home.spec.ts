import { test, expect } from "@playwright/test";

test("home page loads and shows the placeholder shell", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Roicians Tech")).toBeVisible();
  await expect(page.getByText("Training Management System / LMS")).toBeVisible();
});
