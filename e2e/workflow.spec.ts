import { test, expect } from "@playwright/test";
test("practice, history, admin and timed exam controls", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: "Build confidence. Practice with purpose.",
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Networking/ }).click();
  await expect(page.getByText(/Select 1 answer/)).toBeVisible();
  await page.locator(".option").first().click();
  await page
    .getByRole("button", { name: "Flag for review", exact: true })
    .click();
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "Finish & review", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Practice completed" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Review incorrect answers", exact: true })
    .click();
  await expect(
    page.getByText("No verified incorrect answers", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Back to dashboard" }).click();
  await page.getByRole("button", { name: "Attempt history" }).click();
  await expect(page.locator(".option").first()).toBeVisible();
  await page.getByRole("button", { name: "Question admin" }).click();
  await expect(
    page.getByRole("heading", { name: "Question management" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Validate & save" }).click();
  await expect(page.getByText("Saved 81 validated questions.")).toBeVisible();
  await page.getByRole("button", { name: "Dashboard", exact: true }).click();
  await page.getByRole("button", { name: "Start timed exam" }).click();
  await expect(page.getByText(/remaining$/)).toBeVisible();
  await expect(page.locator(".numbers button")).toHaveCount(81);
  await page
    .getByRole("button", { name: "Toggle light and dark mode" })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
