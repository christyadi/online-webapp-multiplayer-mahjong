import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

test("an exposed kong is visible to every player", async ({ browser }) => {
  const contexts: BrowserContext[] = [];
  try {
    const host = await newGuestPage(browser, contexts);
    await host.goto("/");
    await createRoom(host, "Host");
    const friend = await newGuestPage(browser, contexts);
    await friend.goto(host.url());
    await friend.getByLabel("Nickname").fill("Friend");
    await friend.getByRole("button", { name: "Join room" }).click();
    await friend.getByRole("button", { name: "I’m ready" }).click();
    await host.getByRole("button", { name: "I’m ready" }).click();
    await host.getByRole("button", { name: "Start hand" }).click();
    await expect(
      host.getByRole("button", { name: "Upgrade Pung to Kong with 3 of dots" }),
    ).toBeVisible();

    await host.getByRole("button", { name: "Upgrade Pung to Kong with 3 of dots" }).click();

    await expect(host.getByLabel("Host melds")).toBeVisible();
    await expect(friend.getByLabel("Host melds")).toBeVisible();
    await expect(friend.locator(".table-activity")).toContainText("Host called Kong.");
    await expect(host.locator(".player-panel.seat-0 .meld-tiles .tile-art")).toHaveCount(4);
    await expect(friend.locator(".player-panel.seat-0 .meld-tiles .tile-art")).toHaveCount(4);
    await expect(friend.locator(".player-panel.seat-0 .meld-name")).toHaveCount(0);
    await expect(host.getByRole("alert")).toHaveCount(0);
    await expect(friend.getByRole("alert")).toHaveCount(0);
  } finally {
    await Promise.all(contexts.map(async (context) => context.close()));
  }
});

async function newGuestPage(browser: Browser, contexts: BrowserContext[]): Promise<Page> {
  const context = await browser.newContext();
  contexts.push(context);
  return context.newPage();
}

async function createRoom(page: Page, nickname: string): Promise<void> {
  await page.getByLabel("Nickname").fill(nickname);
  await page.getByRole("button", { name: "Create a private room" }).click();
  await expect(page.getByRole("heading", { name: "Your private table" })).toBeVisible();
}
