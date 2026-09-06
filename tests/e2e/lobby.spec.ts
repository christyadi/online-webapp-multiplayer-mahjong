import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

test("isolated guests keep distinct seats through joins and refresh", async ({
  browser,
}, testInfo) => {
  if (testInfo.project.name === "webkit") testInfo.setTimeout(60_000);
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
    const refreshed = host.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/rooms/current" &&
        response.request().method() === "GET",
    );
    await host
      .getByRole("button", { name: "Refresh players" })
      .evaluate((button: HTMLButtonElement) => button.click());
    expect((await refreshed).status()).toBe(200);

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

test("ready players can start a hand with bots in empty seats", async ({ browser }, testInfo) => {
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

    await expect(host.getByRole("heading", { name: "Mahjong table" })).toBeAttached();
    const viewport = host.viewportSize();
    const tableBox = await host.locator(".table-shell").boundingBox();
    expect(tableBox?.width).toBe(viewport?.width);
    expect(tableBox?.height).toBeGreaterThanOrEqual((viewport?.height ?? 0) - 1);
    expect(
      await host.evaluate(
        () => (document.scrollingElement?.scrollHeight ?? 0) <= window.innerHeight + 1,
      ),
    ).toBe(true);
    await expect(host.locator(".seat-detail", { hasText: "Bot" })).toHaveCount(2);
    await expect(host.locator(".table-seat")).toHaveCount(4);
    await expect(host.locator(".seat-position-south .tile-rack")).toBeVisible();
    await expect(host.locator(".seat-position-east .tile-rack")).toHaveCount(0);
    await expect(host.locator(".player-panel.is-active")).toHaveCount(1);
    await expect(host.getByText("Playing · choose discard")).toBeVisible();
    await expect(host.getByText("Waiting for discard")).toHaveCount(3);
    await expect(host.locator(".seat-turn-timer")).toHaveCount(1);
    await expect(host.locator(".table-activity")).toContainText("choosing a discard");
    await expect(host.locator(".draggable-tile.is-drawn-tile")).toHaveCount(1);
    await expect(host.locator(".player-panel.seat-0")).toHaveClass(/seat-0/);
    await expect(host.locator(".table-center .discard-pool")).toBeVisible();
    await expect(host.getByText("Waiting for the first discard")).toBeVisible();
    await expect(host.locator(".player-panel .discard-strip")).toHaveCount(0);
    if (testInfo.project.name.startsWith("phone")) {
      const undersizedControls = await host.locator("button:visible").evaluateAll((buttons) =>
        buttons
          .map((button) => ({
            height: button.getBoundingClientRect().height,
            label: button.getAttribute("aria-label") ?? button.textContent.trim(),
            width: button.getBoundingClientRect().width,
          }))
          .filter((button) => button.width < 44 || button.height < 44),
      );
      expect(undersizedControls).toEqual([]);
    }
    const activeTheme = await host.locator("html").getAttribute("data-theme");
    if (activeTheme !== "light" && activeTheme !== "dark")
      throw new Error("Theme was not initialized");
    const nextTheme = activeTheme === "dark" ? "light" : "dark";
    await host.getByRole("button", { name: `Switch to ${nextTheme} mode` }).click();
    await expect(host.locator("html")).toHaveAttribute("data-theme", nextTheme);
    await expect(host.locator(".table-felt")).toBeVisible();
    await expect(host.locator(".tile-rack .tile-art").first()).toBeVisible();
    const tableRules = host.getByRole("button", { name: "Table rules" });
    await tableRules.click();
    await expect(host.getByRole("dialog", { name: "How to play" })).toBeVisible();
    const closeRules = host.getByRole("button", { name: "Close How to play" });
    await expect(closeRules).toBeFocused();
    await host.keyboard.press("Tab");
    await expect(closeRules).toBeFocused();
    await host.keyboard.press("Escape");
    await expect(host.getByRole("dialog", { name: "How to play" })).toHaveCount(0);
    await expect(tableRules).toBeFocused();
    await host.reload();
    await expect(host.getByRole("heading", { name: "Mahjong table" })).toBeAttached();
    await expect(host.locator(".seat-position-south .tile-rack .tile-art")).toHaveCount(14);
    await expect(host.locator(".tile-rack .tile-art")).toHaveCount(14);
    await expect(host.locator(".tile-rack .tile-art").first()).toHaveAttribute(
      "aria-label",
      /value/,
    );
    await expect(host.getByRole("button", { name: "Sort hand" })).toBeVisible();
    await expect(host.getByText("Drag tiles or select one to move it")).toBeVisible();
    const rackTiles = host.locator(".tile-rack .draggable-tile");
    const beforeOrder = await rackTiles.evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("data-tile-id")),
    );
    if (testInfo.project.name !== "webkit") {
      await rackTiles.first().dragTo(rackTiles.last());
      const afterOrder = await rackTiles.evaluateAll((elements) =>
        elements.map((element) => element.getAttribute("data-tile-id")),
      );
      expect(afterOrder).not.toEqual(beforeOrder);
    }
    if (testInfo.project.name.startsWith("phone")) {
      const touchSource = rackTiles.first();
      const touchTarget = rackTiles.nth(2);
      const sourceId = await touchSource.getAttribute("data-tile-id");
      await touchSource.scrollIntoViewIfNeeded();
      const targetBox = await touchTarget.boundingBox();
      const grip = touchSource.locator(".tile-drag-grip");
      const gripBox = await grip.boundingBox();
      if (gripBox === null || targetBox === null)
        throw new Error("Touch tile positions unavailable");
      await grip.dispatchEvent("pointerdown", {
        clientX: gripBox.x + gripBox.width / 2,
        clientY: gripBox.y + gripBox.height / 2,
        pointerId: 1,
        pointerType: "touch",
      });
      await grip.dispatchEvent("pointerup", {
        clientX: targetBox.x + targetBox.width / 2,
        clientY: targetBox.y + targetBox.height / 2,
        pointerId: 1,
        pointerType: "touch",
      });
      await expect(rackTiles.nth(1)).toHaveAttribute("data-tile-id", sourceId ?? "");
    }
    const discard = host.getByRole("button", { name: "Discard selected" });
    await expect(discard).toBeDisabled();
    const firstTile = host.locator(".tile-rack .tile-button").first();
    await firstTile.scrollIntoViewIfNeeded();
    await expect(firstTile).toBeInViewport();
    await firstTile.focus();
    await host.keyboard.press("Enter");
    await expect(discard).toBeEnabled();
    await expect(firstTile).toHaveAttribute("aria-pressed", "true");
    const selectedTileId = await firstTile.locator("xpath=..").getAttribute("data-tile-id");
    await host.getByRole("button", { name: "Move selected tile right" }).click();
    await expect(rackTiles.nth(1)).toHaveAttribute("data-tile-id", selectedTileId ?? "");
    await expect(host.getByRole("button", { name: "Move selected tile left" })).toBeEnabled();
    await host.locator(".tile-rack .tile-button[aria-pressed='true']").focus();
    await host.keyboard.press("Enter");
    await expect(discard).toBeDisabled();
    await firstTile.click();
    await expect(discard).toBeEnabled();
    await discard.scrollIntoViewIfNeeded();
    await expect(discard).toBeInViewport();
    if (testInfo.project.name === "webkit") {
      await discard.evaluate((button: HTMLButtonElement) => button.click());
    } else await discard.click();
    await expect(host.locator(".table-felt")).toBeVisible();
    await expect(host.locator(".table-activity")).toContainText("Host discarded");
    await expect(host.locator(".table-footer").getByText("Connected")).toBeVisible();
  } finally {
    await Promise.all(contexts.map(async (context) => context.close()));
  }
});

test("leaving an active hand releases the guest for a new room", async ({ page }) => {
  await page.goto("/");
  await createRoom(page, "Host");
  await page.getByRole("button", { name: "I’m ready" }).click();
  await page.getByRole("button", { name: "Start hand" }).click();
  await expect(page.getByRole("heading", { name: "Mahjong table" })).toBeAttached();

  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Leave game" }).click();
  await expect(page.getByRole("heading", { name: "Mahjong Together" })).toBeVisible();

  await createRoom(page, "New host");
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

  await page
    .getByRole("button", { name: "Refresh players" })
    .evaluate((button: HTMLButtonElement) => button.click());

  await expect(page.getByRole("heading", { name: "Room expired" })).toBeVisible();
  await expect(page.getByText("This private room is no longer available")).toBeVisible();
  await page.getByRole("button", { name: "Return home" }).click();
  await expect(page.getByRole("heading", { name: "Mahjong Together" })).toBeVisible();
});

test("a room already occupied by this tab expires after a reload with no server state", async ({
  page,
}) => {
  await page.goto("/");
  await createRoom(page, "Host");
  await page.route("**/api/rooms/current", async (route) => {
    await route.fulfill({ contentType: "application/json", json: { room: null }, status: 200 });
  });

  await page.reload();

  await expect(page.getByRole("heading", { name: "Room expired" })).toBeVisible();
  await page.getByRole("button", { name: "Return home" }).click();
  await expect(page.getByRole("heading", { name: "Mahjong Together" })).toBeVisible();
});

test("a stale occupied-room marker does not block a different invite", async ({ page }) => {
  await page.goto("/");
  await createRoom(page, "Host");
  await page.route("**/api/rooms/current", async (route) => {
    await route.fulfill({ contentType: "application/json", json: { room: null }, status: 200 });
  });

  await page.goto("/room/freshroom001");

  await expect(page.getByRole("heading", { name: "Join Mahjong Together" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Join room" })).toBeEnabled();
  await expect
    .poll(() =>
      page.evaluate(() => window.sessionStorage.getItem("mahjong-together:occupied-room")),
    )
    .toBeNull();
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
