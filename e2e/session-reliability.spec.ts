import { test, expect, type Page } from "@playwright/test";

async function startTimed(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Mock Exam", exact: true }).click();
  await page
    .getByRole("button", { name: "Start timed exam", exact: true })
    .first()
    .click();
  const replace = page.getByRole("button", {
    name: "Start new session",
    exact: true,
  });
  if (await replace.isVisible()) await replace.click();
  await expect(
    page.getByRole("heading", { name: "Question 1 of 60", exact: true }),
  ).toBeVisible();
}
async function warnIsActive(page: Page) {
  return page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
}

test("confirmed autosave survives refresh with answers, flags, position and original countdown", async ({
  page,
  request,
}) => {
  await startTimed(page);
  const original = await (await request.get("/api/sessions")).json();
  await page.locator(".option").first().click();
  await page
    .getByRole("button", { name: "Flag for review", exact: true })
    .click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.locator(".option").first().click();
  await page
    .getByRole("button", { name: "Flag for review", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Go to question 5", exact: true })
    .click();
  await expect(page.getByRole("status")).toHaveText("Progress saved");
  const saved = await (await request.get("/api/sessions")).json();
  expect(saved.deadline).toBe(original.deadline);
  expect(saved.paused).toBe(false);
  expect(saved.index).toBe(4);
  expect(saved.flags).toHaveLength(2);
  expect(Object.keys(saved.answers)).toHaveLength(2);
  expect(await warnIsActive(page)).toBe(false);
  const timer = await page.locator(".timer").innerText();
  await expect(page.locator(".timer")).not.toHaveText(timer);
  await page.reload();
  await page.getByRole("button", { name: "Resume exam", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Question 5 of 60", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".timer")).toContainText("remaining");
  const resumed = await (await request.get("/api/sessions")).json();
  expect(resumed.deadline).toBe(original.deadline);
  expect(resumed.answers).toEqual(saved.answers);
  expect(resumed.flags).toEqual(saved.flags);
  await page
    .getByRole("button", { name: "Go to question 1, flagged", exact: true })
    .click();
  await expect(page.locator(".option[aria-pressed=true]")).toHaveCount(1);
  await page.getByRole("button", { name: "Pause & save", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Resume exam", exact: true }),
  ).toBeVisible();
});

test("failed autosave shows recovery and keeps refresh protection until retry succeeds", async ({
  page,
}) => {
  await startTimed(page);
  let fail = true;
  await page.route("**/api/sessions", async (route) => {
    if (route.request().method() === "PATCH" && fail) {
      fail = false;
      return route.fulfill({
        status: 503,
        json: { error: "Temporary save outage" },
      });
    }
    return route.continue();
  });
  await page.locator(".option").first().click();
  await expect(page.getByRole("status")).toContainText("Progress not saved");
  expect(await warnIsActive(page)).toBe(true);
  await page.getByRole("button", { name: "Retry save", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Progress saved");
  expect(await warnIsActive(page)).toBe(false);
  await page.reload();
  await page.getByRole("button", { name: "Resume exam", exact: true }).click();
  await expect(page.locator(".option[aria-pressed=true]")).toHaveCount(1);
  await page.getByRole("button", { name: "Pause & save", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Resume exam", exact: true }),
  ).toBeVisible();
});

test("rapid changes during an in-flight autosave persist the final answer and position", async ({
  page,
  request,
}) => {
  await startTimed(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let saveRequests = 0;
  await page.route("**/api/sessions", async (route) => {
    if (
      route.request().method() === "PATCH" &&
      route.request().postDataJSON().action === "save"
    ) {
      saveRequests++;
      if (saveRequests === 1) await gate;
    }
    await route.continue();
  });
  await page.locator(".option").nth(0).click();
  await expect.poll(() => saveRequests).toBe(1);
  // Clear between choices so this also covers randomly selected multi-answer questions.
  await page.locator(".option").nth(0).click();
  await page.locator(".option").nth(1).click();
  await page.locator(".option").nth(1).click();
  await page.locator(".option").nth(2).click();
  await page
    .getByRole("button", { name: "Flag for review", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Go to question 8", exact: true })
    .click();
  expect(await warnIsActive(page)).toBe(true);
  expect(saveRequests).toBe(1);
  release();
  await expect(page.getByRole("status")).toHaveText("Progress saved");
  const saved = await (await request.get("/api/sessions")).json();
  expect(saved.answers[saved.questions[0].id]).toEqual([
    saved.questions[0].options[2].id,
  ]);
  expect(saved.flags).toEqual([saved.questions[0].id]);
  expect(saved.index).toBe(7);
  expect(saved.paused).toBe(false);
  await page.getByRole("button", { name: "Pause & save", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Resume exam", exact: true }),
  ).toBeVisible();
});
