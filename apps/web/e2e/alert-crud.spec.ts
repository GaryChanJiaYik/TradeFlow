import { test, expect } from "@playwright/test";

/**
 * End-to-end alert CRUD flow: sign up, log in, create an alert, see it
 * listed, edit it, delete it.
 *
 * Requires a live Supabase project (NEXT_PUBLIC_SUPABASE_URL /
 * NEXT_PUBLIC_SUPABASE_ANON_KEY in apps/web/.env.local) with "Confirm email"
 * disabled under Authentication settings — otherwise signUp does not return
 * an active session and this test cannot log in immediately after signup.
 * See docs/SETUP.md.
 */
test("sign up, log in, create/edit/delete an alert", async ({ page }) => {
  const uniqueEmail = `e2e-${Date.now()}@example.com`;
  const password = "TestPassword123!";

  await page.goto("/signup");
  await page.getByLabel("Email").fill(uniqueEmail);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign up" }).click();

  await expect(page).toHaveURL(/\/dashboard/);

  // Log out, then log back in to exercise the login flow explicitly.
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login/);

  await page.getByLabel("Email").fill(uniqueEmail);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  // Create an alert.
  await page.getByRole("link", { name: "New alert" }).click();
  await page.getByLabel("Target price").fill("3450");
  await page.getByLabel("Direction").selectOption("CROSS_UP");
  await page.getByLabel("Trigger mode").selectOption("ONCE");
  await page.getByRole("button", { name: "Create alert" }).click();

  await expect(page).toHaveURL(/\/dashboard/);
  const row = page.getByRole("row", { name: /3450/ });
  await expect(row).toBeVisible();

  // Edit the alert.
  await row.getByRole("link", { name: "Edit" }).click();
  await page.getByLabel("Target price").fill("3475");
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect(page).toHaveURL(/\/dashboard/);
  const updatedRow = page.getByRole("row", { name: /3475/ });
  await expect(updatedRow).toBeVisible();

  // Delete the alert.
  await updatedRow.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("row", { name: /3475/ })).toHaveCount(0);
});
