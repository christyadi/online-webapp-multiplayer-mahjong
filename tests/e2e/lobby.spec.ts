import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

test("isolated guests keep distinct seats through joins and refresh", async ({ browser }) => {
  const contexts: BrowserContext[] = [];
  try {
    const host = await newGuestPage(browser, contexts);
    await host.goto("/");
    await createRoom(host, "Same name");
    const inviteUrl = host.url();

    const guests: Page[] = [];
    for (const expectedSeat of ["South", "West", "North"]) {
      const guest = await newGuestPage(browser, contexts);
      guests.push(guest);
      await guest.goto(inviteUrl);
      await guest.getByLabel("Nickname").fill("Same name");
      await guest.getByRole("button", { name: "Join room" }).click();
      await expect(guest.getByText(`You are ${expectedSeat}`)).toBeVisible();
    }

    await expect(host.locator(".seat-detail", { hasText: "Same name" })).toHaveCount(4);
    await host.getByRole("button", { name: "Refresh players" }).click();

    await guests[0].reload();
    await expect(guests[0].getByText("You are South")).toBeVisible();
    await expect(guests[0].getByRole("button", { name: "Start hand" })).toHaveCount(0);

    const fifth = await newGuestPage(browser, contexts);
    await fifth.goto(inviteUrl);
    await fifth.getByLabel("Nickname").fill("Fifth player");
    await fifth.getByRole("button", { name: "Join room" }).click();
    await expect(fifth.getByRole("alert")).toHaveText("This room already has four players");
  } finally {
    await Promise.all(contexts.map(async (context) => context.close()));
  }
});

test("ready players can start a hand with bots in empty seats", async ({ browser }) => {
  const contexts: BrowserContext[] = [];
  try {
    const host = await newGuestPage(browser, contexts);
    await host.goto("/");
    await createRoom(host, "Host");
    const inviteUrl = host.url();
    const friend = await newGuestPage(browser, contexts);
    await friend.goto(inviteUrl);
    await friend.getByLabel("Nickname").fill("Friend");
    await friend.getByRole("button", { name: "Join room" }).click();

    await friend.getByRole("button", { name: "I’m ready" }).click();
    await host.getByRole("button", { name: "I’m ready" }).click();
    await expect(host.getByRole("button", { name: "Start hand" })).toBeEnabled();
    await host.getByRole("button", { name: "Start hand" }).click();

    await expect(host.getByRole("heading", { name: "Hand starting" })).toBeVisible();
    await expect(host.locator(".seat-detail", { hasText: "Bot" })).toHaveCount(2);
    await expect(host.locator(".tile-rack .tile-art")).toHaveCount(14);
    const discard = host.getByRole("button", { name: "Discard selected" });
    await expect(discard).toBeDisabled();
    await host.locator(".tile-rack .tile-button").first().click();
    await expect(discard).toBeEnabled();
    await discard.click();
    await expect(host.locator(".table-felt")).toBeVisible();
    await expect(host.getByText(/server revision/)).toBeVisible();
  } finally {
    await Promise.all(contexts.map(async (context) => context.close()));
  }
});

test("a delayed join refresh cannot resurrect a room after a newer clear", async ({ browser }) => {
  const contexts: BrowserContext[] = [];
  try {
    const host = await newGuestPage(browser, contexts);
    await host.goto("/");
    await createRoom(host, "Host");
    const inviteUrl = host.url();

    const guest = await newGuestPage(browser, contexts);
    await guest.goto(inviteUrl);
    await expect(guest.getByRole("heading", { name: "Join Mahjong Together" })).toBeVisible();

    let currentRequest = 0;
    let markDelayedCaptured = () => undefined;
    const delayedCaptured = new Promise<void>((resolve) => {
      markDelayedCaptured = resolve;
    });
    let releaseDelayed = () => undefined;
    const delayedRelease = new Promise<void>((resolve) => {
      releaseDelayed = resolve;
    });
    let markNewerCleared = () => undefined;
    const newerCleared = new Promise<void>((resolve) => {
      markNewerCleared = resolve;
    });
    await guest.route("**/api/rooms/current", async (route) => {
      currentRequest += 1;
      if (currentRequest === 1) {
        const capturedRoom = await route.fetch();
        markDelayedCaptured();
        await delayedRelease;
        await route.fulfill({ response: capturedRoom });
        return;
      }
      await route.fulfill({ contentType: "application/json", json: { room: null }, status: 200 });
      markNewerCleared();
    });

    await guest.getByLabel("Nickname").fill("Guest");
    await guest.getByRole("button", { name: "Join room" }).click();
    await delayedCaptured;
    await guest.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await newerCleared;
    releaseDelayed();

    await expect(guest.getByRole("button", { name: "Join room" })).toBeEnabled();
    await expect(guest.getByRole("heading", { name: "Join Mahjong Together" })).toBeVisible();
    expect(guest.url()).toBe(inviteUrl);
  } finally {
    await Promise.all(contexts.map(async (context) => context.close()));
  }
});

test("an expired current room becomes a clear recoverable screen", async ({ page }) => {
  await page.goto("/");
  await createRoom(page, "Host");
  await page.route("**/api/rooms/current", async (route) => {
    await route.fulfill({ contentType: "application/json", json: { room: null }, status: 200 });
  });

  await page.getByRole("button", { name: "Refresh players" }).click();

  await expect(page.getByRole("heading", { name: "Room expired" })).toBeVisible();
  await expect(page.getByText("This private room is no longer available")).toBeVisible();
  await page.getByRole("button", { name: "Return home" }).click();
  await expect(page.getByRole("heading", { name: "Mahjong Together" })).toBeVisible();
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
