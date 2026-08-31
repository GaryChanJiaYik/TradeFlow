import { test, expect } from "@playwright/test";

/**
 * End-to-end graph reminder CRUD flow: sign up, create a reminder, see it
 * listed, edit it, delete it. Mirrors alert-crud.spec.ts's structure and the
 * same live-Supabase-project requirements (see that file's doc comment).
 */
test("sign up, create/edit/delete a chart reminder", async ({ page }) => {
  const uniqueEmail = `e2e-reminder-${Date.now()}@example.com`;
  const password = "TestPassword123!";

  await page.goto("/signup");
  await page.getByLabel("Email").fill(uniqueEmail);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign up" }).click();

  await expect(page).toHaveURL(/\/dashboard/);

  // Navigate to Reminders from the dashboard.
  await page.getByRole("link", { name: "Reminders" }).click();
  await expect(page).toHaveURL(/\/dashboard\/reminders/);

  // Create a reminder.
  await page.getByRole("link", { name: "New reminder" }).click();
  await page.getByLabel("Timeframe").selectOption("4H");
  await page.getByLabel("Description (optional)").fill("Check the trendline");
  await page.getByRole("button", { name: "Create reminder" }).click();

  await expect(page).toHaveURL(/\/dashboard\/reminders/);
  const row = page.getByRole("row", { name: /Check the trendline/ });
  await expect(row).toBeVisible();
  await expect(row.getByText("4H")).toBeVisible();

  // Edit the reminder.
  await row.getByRole("link", { name: "Edit" }).click();
  await page.getByLabel("Description (optional)").fill("Check the breakout level");
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect(page).toHaveURL(/\/dashboard\/reminders/);
  const updatedRow = page.getByRole("row", { name: /Check the breakout level/ });
  await expect(updatedRow).toBeVisible();

  // Delete the reminder.
  await updatedRow.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("row", { name: /Check the breakout level/ })).toHaveCount(0);
});
