import { expect, test, type Page } from "@playwright/test";

test("a winning result identifies the dealer, source, and complete winning combination", async ({
  page,
}) => {
  await startWinningHand(page);

  await expect(page.getByText("East wins", { exact: true })).toBeVisible();
  await expect(page.getByText("Win by self draw.", { exact: true })).toBeVisible();
  const combination = page.getByLabel("Winning combination");
  await expect(combination).toBeVisible();
  await expect(combination.locator(".tile-art")).toHaveCount(14);
  await expect(combination.getByText("Pair", { exact: true })).toBeVisible();
  await expect(page.getByText("East · Dealer", { exact: true })).toBeVisible();
});

async function startWinningHand(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Nickname").fill("Host");
  await page.getByRole("button", { name: "Create a private room" }).click();
  await page.getByRole("button", { name: "I’m ready" }).click();
  await page.getByRole("button", { name: "Start hand" }).click();
  await expect(page.getByText("East wins", { exact: true })).toBeVisible();
}
