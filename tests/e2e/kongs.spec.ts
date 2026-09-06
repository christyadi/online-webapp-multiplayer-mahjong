import { expect, test, type Page } from "@playwright/test";

test("a player can upgrade an exposed pung to a legal added kong", async ({ page }) => {
  await startKongHand(page);

  await page.getByRole("button", { name: "Upgrade Pung to Kong with 3 of dots" }).click();

  await expect(page.getByLabel("Host exposed melds")).toContainText("Kong");
  await expect(page.locator(".player-panel.seat-0 .meld-tiles .tile-art")).toHaveCount(4);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

async function startKongHand(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Nickname").fill("Host");
  await page.getByRole("button", { name: "Create a private room" }).click();
  await page.getByRole("button", { name: "I’m ready" }).click();
  await page.getByRole("button", { name: "Start hand" }).click();
  await expect(
    page.getByRole("button", { name: "Upgrade Pung to Kong with 3 of dots" }),
  ).toBeVisible();
}
