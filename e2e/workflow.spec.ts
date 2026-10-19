import { test, expect } from "@playwright/test";

test("topic practice, saved progress, honest results, history and mock controls", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Welcome back.", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".topic-card")).toHaveCount(6);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Topic Practice", exact: true })
    .click();
  const networking = page
    .locator(".topic-card")
    .filter({
      has: page.getByRole("heading", { name: "Networking", exact: true }),
    });
  await networking.getByRole("button").click();
  if (
    await page
      .getByRole("dialog", { name: "You have a saved session" })
      .isVisible()
  )
    await page
      .getByRole("button", { name: "Start new session", exact: true })
      .click();
  await expect(
    page.getByRole("heading", { name: /Question 1 of/ }),
  ).toBeVisible();
  await expect(page.locator(".exam-header .eyebrow")).toHaveText("Networking");
  const count = await page.locator(".numbers button").count();
  expect(count).toBeGreaterThan(0);
  expect(count).toBeLessThan(60);
  await page.locator(".option").first().click();
  await page.getByRole("button", { name: "Check answer", exact: true }).click();
  await expect(page.getByText("ANSWER REVIEW", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Flag for review", exact: true })
    .click();
  await page.getByRole("button", { name: "Pause & save", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Resume exam", exact: true }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Resume exam", exact: true }).click();
  await expect(page.locator(".option[aria-pressed=true]")).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Flagged for review", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Finish & review", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Finish this attempt?",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Finish & review", exact: true }),
  ).toBeFocused();
  await page
    .getByRole("button", { name: "Finish & review", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Submit & view results", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Practice completed", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".score-ring")).toContainText("ungraded");
  await page.locator(".review-card summary").first().click();
  await expect(page.locator(".review-card[open] .explanation")).toBeVisible();
  await page
    .getByRole("button", { name: "Review incorrect answers", exact: true })
    .click();
  await expect(
    page.getByText("No verified incorrect answers", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Attempt history", exact: true })
    .click();
  await expect(page.locator(".activity-item").first()).toContainText(
    "Networking practice",
  );
  await page.getByRole("button", { name: "Mock Exam", exact: true }).click();
  await page
    .getByRole("button", { name: "Start timed exam", exact: true })
    .first()
    .click();
  await expect(page.locator(".timer")).toContainText("remaining");
  await expect(page.locator(".numbers button")).toHaveCount(60);
  await page.getByRole("button", { name: "Pause & save", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Resume exam", exact: true }),
  ).toBeVisible();
  await page.locator('summary[aria-label="Account and appearance"]').click();
  await page
    .getByRole("button", { name: "Toggle light and dark mode", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.locator('summary[aria-label="Account and appearance"]').click();
  await page
    .getByRole("button", { name: "Question admin", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Question management" }),
  ).toBeVisible();
  // No admin writes are needed for a visual regression smoke test.
});
