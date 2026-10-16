import { test, expect } from "@playwright/test";
test("practice, history, admin and timed exam controls", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: "Pass your cloud exam with confidence.",
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Review mode/ }).click();
  await page.getByRole("button", { name: /Networking/ }).click();
  await expect(page.getByText(/Select 1 answer/)).toBeVisible();
  await page.locator(".option").first().click();
  await page.getByRole("button", { name: "Check answer", exact: true }).click();
  await expect(page.getByText("Not yet verified", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Flag for review", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Finish & review", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Finish this attempt?" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Submit & view results", exact: true })
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
  await page
    .getByRole("button", { name: "Attempt history", exact: true })
    .click();
  await expect(page.locator(".option").first()).toBeVisible();
  await page.getByRole("button", { name: "Question admin" }).click();
  await expect(
    page.getByRole("heading", { name: "Question management" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Validate & save" }).click();
  await expect(
    page.getByText("Saved 81 validated questions to this bank."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Dashboard", exact: true }).click();
  await page.getByRole("button", { name: /Timed mode/ }).click();
  await page.getByRole("button", { name: /Start exam/ }).first().click();
  await expect(page.locator(".timer")).toBeVisible();
  await expect(page.locator(".numbers button")).toHaveCount(60);
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
