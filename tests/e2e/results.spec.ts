import { expect, test, type Page } from "@playwright/test";

test("a host can start the next hand from the completed result banner", async ({ page }) => {
  await startCompletedHand(page);

  await expect(page.getByText("Draw hand", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Return to lobby" })).toBeEnabled();
  const autoPlay = page.getByRole("checkbox", { name: /Auto-play next hand/ });
  await expect(autoPlay).toBeChecked();
  await autoPlay.uncheck();
  await expect(autoPlay).not.toBeChecked();
  let rematchStarts = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname.endsWith("/start")) {
      rematchStarts += 1;
    }
  });
  await page.waitForTimeout(16_000);
  await expect(page.getByText("Draw hand", { exact: true })).toBeVisible();
  expect(rematchStarts).toBe(0);
  await expect(page.getByRole("alert")).toHaveCount(0);

  await page.getByRole("button", { name: "Play again" }).click();

  await expect(page.getByText("Draw hand", { exact: true })).toBeHidden();
  await expect(page.locator(".table-felt")).toBeVisible();
  await expect(page.locator(".result-banner")).toHaveCount(0);
  expect(rematchStarts).toBe(1);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("a completed hand automatically rematches after fifteen seconds by default", async ({
  page,
}) => {
  await startCompletedHand(page);

  let rematchStarts = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname.endsWith("/start")) {
      rematchStarts += 1;
    }
  });
  await expect(page.getByText(/Auto-play next hand in \d+s/)).toBeVisible();
  await page.waitForTimeout(14_000);
  await expect(page.getByText("Draw hand", { exact: true })).toBeVisible();
  await expect(page.getByText("Draw hand", { exact: true })).toBeHidden({ timeout: 20_000 });
  await expect(page.locator(".table-felt")).toBeVisible();
  await expect(page.locator(".result-banner")).toHaveCount(0);
  expect(rematchStarts).toBe(1);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

async function startCompletedHand(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Nickname").fill("Host");
  await page.getByRole("button", { name: "Create a private room" }).click();
  await page.getByRole("button", { name: "I’m ready" }).click();
  await page.getByRole("button", { name: "Start hand" }).click();
  await expect(page.getByText("Draw hand", { exact: true })).toBeVisible();
}
