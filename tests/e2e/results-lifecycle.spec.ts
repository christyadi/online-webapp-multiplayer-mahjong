import { expect, test } from "@playwright/test";

test("a later completed hand reopens the result dialog after the prior one was closed", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Nickname").fill("Host");
  await page.getByRole("button", { name: "Create a private room" }).click();
  await page.getByRole("button", { name: "I’m ready" }).click();
  await page.getByRole("button", { name: "Start hand" }).click();

  const resultDialog = page.getByRole("dialog", { name: "Draw hand" });
  await expect(resultDialog).toBeVisible();
  await resultDialog.getByRole("button", { name: "Close Draw hand" }).click();
  await expect(page.getByRole("button", { name: "View result" })).toBeVisible();
  await page.getByRole("button", { name: "View result" }).click();
  await expect(resultDialog).toBeVisible();
  await resultDialog.getByRole("button", { name: "Show other hands" }).click();
  await expect(page.getByRole("dialog", { name: "Other players’ hands" })).toBeVisible();

  await page.waitForTimeout(16_000);
  await expect(resultDialog).toBeVisible();
  await expect(page.getByRole("button", { name: "View result" })).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Other players’ hands" })).toHaveCount(0);
});
