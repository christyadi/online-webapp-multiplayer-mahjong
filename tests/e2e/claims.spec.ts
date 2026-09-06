import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

test("a player chooses one Chow option and every player sees the exposed meld", async ({
  browser,
}) => {
  const contexts: BrowserContext[] = [];
  try {
    const host = await newGuestPage(browser, contexts);
    await host.goto("/");
    await createRoom(host, "Host");
    const friend = await newGuestPage(browser, contexts);
    await friend.goto(host.url());
    await friend.getByLabel("Nickname").fill("Claimant");
    await friend.getByRole("button", { name: "Join room" }).click();

    await friend.getByRole("button", { name: "I’m ready" }).click();
    await host.getByRole("button", { name: "I’m ready" }).click();
    await host.getByRole("button", { name: "Start hand" }).click();
    await expect(host.getByRole("heading", { name: "Hand starting" })).toBeVisible();

    await host.getByRole("button", { name: /Select 3 of dots/ }).click();
    await host.getByRole("button", { name: "Discard selected" }).click();

    const chow = friend.getByRole("button", { name: "Chow", exact: true });
    await expect(chow).toHaveCount(1);
    const combinations = friend.getByLabel("Chow combination");
    await expect(combinations).toHaveCount(1);
    await expect(combinations.locator("option")).toHaveText([
      "Chow: 1 of dots, 2 of dots, 3 of dots",
      "Chow: 2 of dots, 3 of dots, 4 of dots",
      "Chow: 3 of dots, 4 of dots, 5 of dots",
    ]);
    await combinations.selectOption({ label: "Chow: 2 of dots, 3 of dots, 4 of dots" });
    await chow.click();

    await expect(friend.getByText("Playing · choose discard")).toBeVisible();
    await expect(friend.getByLabel("Claimant exposed melds")).toContainText("Chow");
    await expect(friend.locator(".player-panel.seat-1 .meld-tiles .tile-art")).toHaveCount(3);
    await expectExposedMiddleChow(friend);
    await expect(host.getByLabel("Claimant exposed melds")).toContainText("Chow");
    await expect(host.locator(".player-panel.seat-1 .meld-tiles .tile-art")).toHaveCount(3);
    await expectExposedMiddleChow(host);
    await expect(friend.getByRole("alert")).toHaveCount(0);
    await expect(host.getByRole("alert")).toHaveCount(0);
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

async function expectExposedMiddleChow(page: Page): Promise<void> {
  const labels = await page
    .locator(".player-panel.seat-1 .meld-tiles [role=img]")
    .evaluateAll((tiles) => tiles.map((tile) => tile.getAttribute("aria-label")));
  expect(labels).toEqual(["2 of dots · value 2", "4 of dots · value 4", "3 of dots · value 3"]);
}
