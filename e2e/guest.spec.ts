import { test, expect, type Page } from "@playwright/test";

// UI contract uses the real Firebase client SDK with synthetic network responses.
// No provider setting, production identity, or production data is touched.
async function cloudFixture(page: Page, disabled = false) {
  const now = Math.floor(Date.now() / 1000);
  const token =
    [
      { alg: "RS256", typ: "JWT" },
      {
        sub: "ui-test-guest",
        user_id: "ui-test-guest",
        aud: "demo-ace-ui",
        iat: now,
        exp: now + 3600,
        auth_time: now,
        firebase: { sign_in_provider: "anonymous", identities: {} },
      },
    ]
      .map((part) => Buffer.from(JSON.stringify(part)).toString("base64url"))
      .join(".") + ".signature";
  let signups = 0;
  await page.route("**/api/config", (route) =>
    route.fulfill({
      json: {
        cloud: true,
        firebase: {
          apiKey: "ui-test-key",
          projectId: "demo-ace-ui",
          authDomain: "demo-ace-ui.firebaseapp.com",
          appId: "ui-test-app",
        },
      },
    }),
  );
  await page.route("**/api/attempts", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/sessions", (route) => route.fulfill({ json: null }));
  await page.route(
    "https://identitytoolkit.googleapis.com/**",
    async (route) => {
      if (route.request().url().includes("accounts:signUp")) {
        signups++;
        if (disabled)
          return route.fulfill({
            status: 400,
            json: { error: { code: 400, message: "OPERATION_NOT_ALLOWED" } },
          });
        return route.fulfill({
          json: {
            localId: "ui-test-guest",
            idToken: token,
            refreshToken: "synthetic-refresh",
            expiresIn: "3600",
            isNewUser: true,
          },
        });
      }
      if (route.request().url().includes("accounts:lookup"))
        return route.fulfill({
          json: {
            users: [
              {
                localId: "ui-test-guest",
                providerUserInfo: [],
                lastLoginAt: String(Date.now()),
                createdAt: String(Date.now()),
              },
            ],
          },
        });
      return route.fulfill({ json: {} });
    },
  );
  return () => signups;
}

test("guest welcome, restored SDK session, account controls and sign-out warning", async ({
  page,
}) => {
  const signups = await cloudFixture(page);
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Continue as Guest", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Continue as Guest", exact: true })
    .click();
  await expect(page.locator(".guest-banner")).toBeVisible();
  expect(signups()).toBe(1);
  await page.reload();
  await expect(page.locator(".guest-banner")).toBeVisible();
  expect(signups()).toBe(1);
  await page.locator('summary[aria-label="Account and appearance"]').click();
  await expect(
    page.getByRole("button", { name: "Question admin", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: "Save My Progress with Google",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Leave your guest account?" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Keep guest session", exact: true })
    .click();
  await expect(page.locator(".guest-banner")).toBeVisible();
});

test("disabled anonymous provider produces an actionable error", async ({
  page,
}) => {
  await cloudFixture(page, true);
  await page.goto("/");
  await page
    .getByRole("button", { name: "Continue as Guest", exact: true })
    .click();
  await expect(page.locator(".error[role=alert]")).toContainText("disabled");
  await expect(
    page.getByRole("button", { name: "Continue with Google", exact: true }),
  ).toBeEnabled();
});
