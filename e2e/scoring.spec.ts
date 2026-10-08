import { test, expect } from "@playwright/test";
import source from "../data/questions.json";

test("five options, exact choose-two scoring and public API secrecy", async ({
  page,
}) => {
  const original = await (await page.request.get("/api/admin")).json();
  const fixture = [source[51], source[72], source[0]].map((q, i) => ({
    ...q,
    prompt: `Synthetic browser fixture ${i}: select the test choices.`,
    topic: "Browser fixtures",
    verification: i < 2 ? "verified" : "ungraded",
    correctOptionIds: i < 2 ? ["B", "E"] : [],
    explanation: i < 2 ? "Synthetic explanation for browser test only" : null,
    references: i < 2 ? ["https://cloud.google.com/docs"] : [],
  }));
  try {
    expect((await page.request.put("/api/admin", { data: fixture })).ok()).toBe(
      true,
    );
    const publicBank = await (await page.request.get("/api/questions")).json();
    for (const q of publicBank) {
      expect(q).not.toHaveProperty("correctOptionIds");
      expect(q).not.toHaveProperty("explanation");
      expect(q).not.toHaveProperty("references");
    }
    for (const scenario of ["full", "partial", "missing"]) {
      await page.goto("/");
      await page.getByRole("button", { name: /Browser fixtures/ }).click();
      for (let i = 0; i < 3; i++) {
        const prompt = await page.locator(".question").innerText();
        if (scenario !== "missing" && !prompt.includes("fixture 2")) {
          await expect(page.locator(".option")).toHaveCount(5);
          await page.locator(".option").nth(4).click();
          if (scenario === "full" || prompt.includes("fixture 1"))
            await page.locator(".option").nth(1).click();
          if (scenario === "full") {
            await page.locator(".option").nth(0).click();
            await expect(
              page.locator(".option[aria-pressed=true]"),
            ).toHaveCount(2);
          }
        }
        if (i < 2)
          await page.getByRole("button", { name: "Next", exact: true }).click();
      }
      page.once("dialog", (d) => d.accept());
      await page
        .getByRole("button", { name: "Finish & review", exact: true })
        .click();
      await expect(
        page.getByText(
          `${scenario === "full" ? 100 : scenario === "partial" ? 50 : 0}% verified score`,
          {
            exact: true,
          },
        ),
      ).toBeVisible();
      await expect(page.getByText(/1 ungraded questions/)).toBeVisible();
      await expect(
        page.getByText("Synthetic explanation for browser test only", {
          exact: true,
        }),
      ).toHaveCount(2);
      await expect(
        page.getByRole("link", {
          name: "Official Google Cloud reference ↗",
          exact: true,
        }),
      ).toHaveCount(2);
    }
  } finally {
    expect(
      (await page.request.put("/api/admin", { data: original })).ok(),
    ).toBe(true);
  }
});
